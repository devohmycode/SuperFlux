use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::Local;
use serde::Deserialize;
use uuid::Uuid;

use crate::clipboard;

#[cfg(not(target_os = "android"))]
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

// ---------------------------------------------------------------------------
// Types (simplified — frontend owns CRUD, we only need keyword + content)
// ---------------------------------------------------------------------------

#[derive(Deserialize, Clone, Debug)]
pub struct SyncSnippet {
    pub keyword: String,
    pub content: String,
    #[serde(default)]
    pub shortcut: Option<String>,
}

pub struct SnippetStore {
    inner: Mutex<Vec<SyncSnippet>>,
}

impl SnippetStore {
    pub fn new() -> Self {
        SnippetStore {
            inner: Mutex::new(Vec::new()),
        }
    }

    pub fn sync(&self, snippets: Vec<SyncSnippet>) {
        let mut inner = self.inner.lock().unwrap();
        *inner = snippets;
    }

    pub fn get_all(&self) -> Vec<SyncSnippet> {
        self.inner.lock().unwrap().clone()
    }
}

// ---------------------------------------------------------------------------
// Dynamic Placeholders
// ---------------------------------------------------------------------------

pub fn resolve_placeholders(content: &str) -> String {
    let now = Local::now();
    let clipboard_text = unsafe { clipboard::read_clipboard_text() }.unwrap_or_default();

    let mut result = content.to_string();

    while result.contains("{uuid}") {
        result = result.replacen("{uuid}", &Uuid::new_v4().to_string().to_uppercase(), 1);
    }

    result = result.replace("{clipboard}", &clipboard_text);
    result = result.replace("{date}", &now.format("%d/%m/%Y").to_string());
    result = result.replace("{time}", &now.format("%H:%M").to_string());
    result = result.replace(
        "{datetime}",
        &now.format("%d/%m/%Y %H:%M").to_string(),
    );
    result = result.replace("{day}", &now.format("%A").to_string());

    result
}

// ---------------------------------------------------------------------------
// Win32 Keyboard Hook – Keyword Expansion
// ---------------------------------------------------------------------------

extern "system" {
    fn SetWindowsHookExW(
        id_hook: i32,
        lpfn: Option<unsafe extern "system" fn(i32, usize, isize) -> isize>,
        hmod: isize,
        thread_id: u32,
    ) -> isize;
    fn CallNextHookEx(hhk: isize, ncode: i32, wparam: usize, lparam: isize) -> isize;
    fn SendInput(count: u32, inputs: *const KeyInput, size: i32) -> u32;
    fn GetMessageW(msg: *mut RawMsg, hwnd: isize, filter_min: u32, filter_max: u32) -> i32;
    fn TranslateMessage(msg: *const RawMsg) -> i32;
    fn DispatchMessageW(msg: *const RawMsg) -> isize;
    fn GetAsyncKeyState(vk: i32) -> i16;
    fn ToUnicode(
        vk: u32,
        scan_code: u32,
        key_state: *const u8,
        buf: *mut u16,
        buf_size: i32,
        flags: u32,
    ) -> i32;
}

const WH_KEYBOARD_LL: i32 = 13;
const WM_KEYDOWN: usize = 0x0100;
const LLKHF_INJECTED: u32 = 0x00000010;
const INPUT_KEYBOARD: u32 = 1;
const KEYEVENTF_KEYUP: u32 = 0x0002;
const VK_BACK: u16 = 0x08;
const VK_CONTROL: u16 = 0x11;
const VK_V: u16 = 0x56;

const BUFFER_CAPACITY: usize = 64;

#[repr(C)]
struct KbdLLHookStruct {
    vk_code: u32,
    scan_code: u32,
    flags: u32,
    time: u32,
    extra_info: usize,
}

#[repr(C)]
#[derive(Default)]
struct RawMsg {
    hwnd: isize,
    message: u32,
    wparam: usize,
    lparam: isize,
    time: u32,
    pt_x: i32,
    pt_y: i32,
}

/// INPUT struct for SendInput (keyboard variant, 40 bytes on x64)
#[repr(C)]
struct KeyInput {
    input_type: u32,
    _pad0: u32,
    vk: u16,
    scan: u16,
    flags: u32,
    time: u32,
    _pad1: u32,
    extra_info: usize,
    _pad2: [u8; 8],
}

// Ring buffer for keystrokes
struct KeyBuffer {
    buf: Vec<char>,
    capacity: usize,
}

impl KeyBuffer {
    fn new(capacity: usize) -> Self {
        Self {
            buf: Vec::with_capacity(capacity),
            capacity,
        }
    }

    fn push(&mut self, ch: char) {
        if self.buf.len() >= self.capacity {
            self.buf.remove(0);
        }
        self.buf.push(ch);
    }

    fn backspace(&mut self) {
        self.buf.pop();
    }

    fn clear(&mut self) {
        self.buf.clear();
    }

    fn ends_with(&self, trigger: &str) -> bool {
        let trigger_chars: Vec<char> = trigger.chars().collect();
        if trigger_chars.len() > self.buf.len() {
            return false;
        }
        let start = self.buf.len() - trigger_chars.len();
        self.buf[start..] == trigger_chars[..]
    }
}

static EXPANDING: AtomicBool = AtomicBool::new(false);

thread_local! {
    static SNIPPET_STORE: std::cell::RefCell<Option<Arc<SnippetStore>>> =
        const { std::cell::RefCell::new(None) };
    static KEY_BUFFER: std::cell::RefCell<KeyBuffer> =
        std::cell::RefCell::new(KeyBuffer::new(BUFFER_CAPACITY));
}

pub fn start_keyword_expander(store: Arc<SnippetStore>) {
    std::thread::spawn(move || unsafe { run_expander_loop(store) });
}

unsafe fn run_expander_loop(store: Arc<SnippetStore>) {
    SNIPPET_STORE.with(|m| *m.borrow_mut() = Some(store));

    let _hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook_proc), 0, 0);
    if _hook == 0 {
        eprintln!("[superflux] Failed to install keyboard hook for snippet expansion");
        return;
    }

    eprintln!("[superflux] Keyboard hook installed for snippet expansion");

    // Message loop required to keep the hook alive
    let mut msg = RawMsg::default();
    while GetMessageW(&mut msg, 0, 0, 0) > 0 {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
}

unsafe extern "system" fn keyboard_hook_proc(
    code: i32,
    wparam: usize,
    lparam: isize,
) -> isize {
    if code >= 0 && wparam == WM_KEYDOWN {
        let kb = &*(lparam as *const KbdLLHookStruct);

        // Skip injected keystrokes (our own SendInput) and during expansion
        if kb.flags & LLKHF_INJECTED != 0 || EXPANDING.load(Ordering::Relaxed) {
            return CallNextHookEx(0, code, wparam, lparam);
        }

        let vk = kb.vk_code;

        // Skip modifier keys (Shift, Ctrl, Alt, Win)
        if is_modifier(vk) {
            return CallNextHookEx(0, code, wparam, lparam);
        }

        KEY_BUFFER.with(|buf| {
            let mut buf = buf.borrow_mut();

            if vk == 0x08 {
                // Backspace
                buf.backspace();
            } else if vk == 0x0D {
                // Enter: check triggers first, then clear
                check_triggers(&buf);
                buf.clear();
            } else {
                // Use ToUnicode to translate VK + scan code into actual character
                if let Some(ch) = vk_to_char_unicode(vk, kb.scan_code) {
                    buf.push(ch);
                    if check_triggers(&buf) {
                        buf.clear();
                    }
                }
            }
        });
    }

    CallNextHookEx(0, code, wparam, lparam)
}

/// Check if the buffer ends with any snippet keyword trigger.
/// Returns `true` if a trigger was matched (and expansion was spawned).
fn check_triggers(buf: &KeyBuffer) -> bool {
    SNIPPET_STORE.with(|m| {
        if let Some(store) = m.borrow().as_ref() {
            let snippets = store.get_all();
            for snippet in &snippets {
                if snippet.keyword.is_empty() {
                    continue;
                }
                let kw = snippet.keyword.to_lowercase();
                if kw.len() >= 2 && buf.ends_with(&kw) {
                    let keyword_len = kw.chars().count();
                    let content = resolve_placeholders(&snippet.content);

                    std::thread::spawn(move || {
                        do_expand(keyword_len, &content);
                    });
                    return true;
                }
            }
        }
        false
    })
}

/// Convert a virtual key to a character using Win32 ToUnicode, then lowercase.
unsafe fn vk_to_char_unicode(vk: u32, scan_code: u32) -> Option<char> {
    let mut key_state = [0u8; 256];

    // Build modifier state from the physical (async) key state.
    for &vk_mod in &[
        0x10u16, // VK_SHIFT
        0x11,    // VK_CONTROL
        0x12,    // VK_MENU  (Alt)
        0xA0,    // VK_LSHIFT
        0xA1,    // VK_RSHIFT
        0xA2,    // VK_LCONTROL
        0xA3,    // VK_RCONTROL
        0xA4,    // VK_LMENU
        0xA5,    // VK_RMENU  (AltGr)
    ] {
        if GetAsyncKeyState(vk_mod as i32) as u16 & 0x8000 != 0 {
            key_state[vk_mod as usize] = 0x80;
        }
    }

    // Toggle keys
    if GetAsyncKeyState(0x14) as u16 & 0x0001 != 0 { // VK_CAPITAL (Caps Lock)
        key_state[0x14] = 0x01;
    }
    if GetAsyncKeyState(0x90) as u16 & 0x0001 != 0 { // VK_NUMLOCK
        key_state[0x90] = 0x01;
    }

    let mut out = [0u16; 4];
    // Flag 0x04 (bit 2): do not alter internal dead-key state (Win 10 1607+)
    let result = ToUnicode(vk, scan_code, key_state.as_ptr(), out.as_mut_ptr(), 4, 0x04);

    if result == 1 {
        let ch = char::from_u32(out[0] as u32)?;
        if ch.is_control() {
            return None;
        }
        Some(ch.to_lowercase().next().unwrap_or(ch))
    } else {
        None
    }
}

fn is_modifier(vk: u32) -> bool {
    matches!(
        vk,
        0x10 | 0x11 | 0x12 |       // Shift, Ctrl, Alt
        0xA0..=0xA5 |               // L/R Shift, Ctrl, Alt
        0x5B | 0x5C                  // L/R Windows key
    )
}

fn make_key_input(vk: u16, flags: u32) -> KeyInput {
    KeyInput {
        input_type: INPUT_KEYBOARD,
        _pad0: 0,
        vk,
        scan: 0,
        flags,
        time: 0,
        _pad1: 0,
        extra_info: 0,
        _pad2: [0; 8],
    }
}

fn do_expand(keyword_len: usize, content: &str) {
    use clipboard::SUPPRESS_CLIPBOARD;
    use std::time::Duration;

    EXPANDING.store(true, Ordering::SeqCst);
    SUPPRESS_CLIPBOARD.store(true, Ordering::SeqCst);

    // Brief delay to let the last typed character be processed
    std::thread::sleep(Duration::from_millis(30));

    // Save current clipboard contents
    let saved_clipboard = unsafe { clipboard::read_clipboard_text() };

    // Send individual backspaces to delete the keyword (5ms gap each)
    let input_size = std::mem::size_of::<KeyInput>() as i32;
    for _ in 0..keyword_len {
        let down = make_key_input(VK_BACK, 0);
        let up = make_key_input(VK_BACK, KEYEVENTF_KEYUP);
        unsafe {
            SendInput(1, &down, input_size);
            SendInput(1, &up, input_size);
        }
        std::thread::sleep(Duration::from_millis(5));
    }

    // Set clipboard to the expanded snippet content
    clipboard::write_clipboard_text(content).ok();
    std::thread::sleep(Duration::from_millis(50));

    // Paste with Ctrl+V
    let paste = [
        make_key_input(VK_CONTROL, 0),
        make_key_input(VK_V, 0),
        make_key_input(VK_V, KEYEVENTF_KEYUP),
        make_key_input(VK_CONTROL, KEYEVENTF_KEYUP),
    ];
    unsafe {
        SendInput(4, paste.as_ptr(), input_size);
    }

    // Wait for paste to complete, then restore original clipboard
    std::thread::sleep(Duration::from_millis(150));

    if let Some(saved) = saved_clipboard {
        clipboard::write_clipboard_text(&saved).ok();
    }

    // Let clipboard restoration settle before re-enabling monitor
    std::thread::sleep(Duration::from_millis(50));
    SUPPRESS_CLIPBOARD.store(false, Ordering::SeqCst);
    EXPANDING.store(false, Ordering::SeqCst);
}

// ---------------------------------------------------------------------------
// Tauri Command — sync snippets from frontend localStorage
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn sync_snippets(
    snippets: Vec<SyncSnippet>,
    store: tauri::State<'_, Arc<SnippetStore>>,
    #[allow(unused)] app: tauri::AppHandle,
) {
    eprintln!("[superflux] Syncing {} snippets to keyboard hook", snippets.len());

    // Re-register global shortcuts for snippets that have them
    #[cfg(not(target_os = "android"))]
    {
        // Unregister old snippet shortcuts
        let old_snippets = store.get_all();
        for s in &old_snippets {
            if let Some(ref sc) = s.shortcut {
                let _ = app.global_shortcut().unregister(sc.as_str());
            }
        }
        // Register new ones
        for s in &snippets {
            if let Some(ref sc) = s.shortcut {
                let content = s.content.clone();
                if register_snippet_shortcut(&app, sc, content).is_ok() {
                    eprintln!("[snippets] Registered shortcut '{}' for keyword '{}'", sc, s.keyword);
                }
            }
        }
    }

    store.sync(snippets);
}

/// Register a global shortcut for a snippet. Resolves placeholders and pastes.
#[cfg(not(target_os = "android"))]
pub fn register_snippet_shortcut(
    app: &tauri::AppHandle,
    shortcut_str: &str,
    content: String,
) -> Result<(), String> {
    let content_clone = content;
    app.global_shortcut()
        .on_shortcut(shortcut_str, move |_app, _shortcut, event| {
            if let ShortcutState::Pressed = event.state {
                let resolved = resolve_placeholders(&content_clone);
                std::thread::spawn(move || {
                    clipboard::SUPPRESS_CLIPBOARD.store(true, Ordering::SeqCst);
                    let _ = clipboard::write_clipboard_text(&resolved);
                    std::thread::sleep(Duration::from_millis(50));
                    clipboard::simulate_paste();
                    std::thread::sleep(Duration::from_millis(100));
                    clipboard::SUPPRESS_CLIPBOARD.store(false, Ordering::SeqCst);
                });
            }
        })
        .map_err(|e| format!("Failed to register snippet shortcut '{}': {}", shortcut_str, e))
}

/// Set or clear a global shortcut for a snippet.
#[tauri::command]
pub fn set_snippet_shortcut(
    keyword: String,
    shortcut: Option<String>,
    content: String,
    store: tauri::State<'_, Arc<SnippetStore>>,
    #[allow(unused)] app: tauri::AppHandle,
) -> Result<Option<String>, String> {
    // Find old shortcut for this keyword and unregister
    #[cfg(not(target_os = "android"))]
    {
        let snippets = store.get_all();
        if let Some(old) = snippets.iter().find(|s| s.keyword == keyword) {
            if let Some(ref old_sc) = old.shortcut {
                let _ = app.global_shortcut().unregister(old_sc.as_str());
            }
        }
    }

    // Register new shortcut if provided
    #[cfg(not(target_os = "android"))]
    if let Some(ref sc) = shortcut {
        register_snippet_shortcut(&app, sc, content)?;
    }

    // Update the store
    {
        let mut inner = store.inner.lock().unwrap();
        if let Some(s) = inner.iter_mut().find(|s| s.keyword == keyword) {
            s.shortcut = shortcut.clone();
        }
    }

    Ok(shortcut)
}
