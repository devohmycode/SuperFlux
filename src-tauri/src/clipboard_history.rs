use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::clipboard;

#[cfg(not(target_os = "android"))]
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

// ── Data model ───────────────────────────────────────────────────────

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct ClipEntry {
    pub id: String,
    pub content: String,
    pub pinned: bool,
    pub timestamp: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shortcut: Option<String>,
}

const DEFAULT_MAX_ENTRIES: usize = 200;
const HISTORY_FILE: &str = "clipboard_history.json";
const SETTINGS_FILE: &str = "clipboard_settings.json";

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct ClipboardSettings {
    pub max_entries: usize,
    /// Retention in milliseconds. 0 = unlimited.
    pub retention_ms: u64,
}

// ── Persistent store ─────────────────────────────────────────────────

pub struct ClipboardHistoryStore {
    entries: Mutex<Vec<ClipEntry>>,
    data_dir: Mutex<Option<std::path::PathBuf>>,
    settings: Mutex<ClipboardSettings>,
}

impl ClipboardHistoryStore {
    pub fn new() -> Self {
        ClipboardHistoryStore {
            entries: Mutex::new(Vec::new()),
            data_dir: Mutex::new(None),
            settings: Mutex::new(ClipboardSettings {
                max_entries: DEFAULT_MAX_ENTRIES,
                retention_ms: 0,
            }),
        }
    }

    pub fn set_data_dir(&self, dir: std::path::PathBuf) {
        *self.data_dir.lock().unwrap() = Some(dir);
        self.load_settings_from_disk();
        self.load_from_disk();
    }

    fn file_path(&self) -> Option<std::path::PathBuf> {
        self.data_dir.lock().unwrap().as_ref().map(|d| d.join(HISTORY_FILE))
    }

    fn load_from_disk(&self) {
        if let Some(path) = self.file_path() {
            if path.exists() {
                match std::fs::read_to_string(&path) {
                    Ok(json) => {
                        if let Ok(entries) = serde_json::from_str::<Vec<ClipEntry>>(&json) {
                            *self.entries.lock().unwrap() = entries;
                            eprintln!("[clipboard_history] Loaded {} entries from disk", self.entries.lock().unwrap().len());
                        }
                    }
                    Err(e) => eprintln!("[clipboard_history] Failed to read history file: {e}"),
                }
            }
        }
    }

    fn save_to_disk(&self) {
        if let Some(path) = self.file_path() {
            let entries = self.entries.lock().unwrap();
            match serde_json::to_string(&*entries) {
                Ok(json) => {
                    if let Err(e) = std::fs::write(&path, json) {
                        eprintln!("[clipboard_history] Failed to write history file: {e}");
                    }
                }
                Err(e) => eprintln!("[clipboard_history] Failed to serialize history: {e}"),
            }
        }
    }

    fn settings_file_path(&self) -> Option<std::path::PathBuf> {
        self.data_dir.lock().unwrap().as_ref().map(|d| d.join(SETTINGS_FILE))
    }

    fn load_settings_from_disk(&self) {
        if let Some(path) = self.settings_file_path() {
            if path.exists() {
                if let Ok(json) = std::fs::read_to_string(&path) {
                    if let Ok(s) = serde_json::from_str::<ClipboardSettings>(&json) {
                        *self.settings.lock().unwrap() = s;
                    }
                }
            }
        }
    }

    fn save_settings_to_disk(&self) {
        if let Some(path) = self.settings_file_path() {
            let s = self.settings.lock().unwrap();
            if let Ok(json) = serde_json::to_string(&*s) {
                let _ = std::fs::write(&path, json);
            }
        }
    }

    pub fn get_settings(&self) -> ClipboardSettings {
        self.settings.lock().unwrap().clone()
    }

    pub fn update_settings(&self, max_entries: usize, retention_ms: u64) {
        {
            let mut s = self.settings.lock().unwrap();
            s.max_entries = max_entries.max(10); // minimum 10
            s.retention_ms = retention_ms;
        }
        self.save_settings_to_disk();
        // Apply: trim entries to new max
        self.trim_entries();
        // Apply: purge old entries by retention
        if retention_ms > 0 {
            self.purge_old(retention_ms);
        }
    }

    fn trim_entries(&self) {
        let max = self.settings.lock().unwrap().max_entries;
        let mut entries = self.entries.lock().unwrap();
        let mut changed = false;
        while entries.len() > max {
            if let Some(pos) = entries.iter().rposition(|e| !e.pinned) {
                entries.remove(pos);
                changed = true;
            } else {
                break;
            }
        }
        drop(entries);
        if changed {
            self.save_to_disk();
        }
    }

    fn purge_old(&self, max_age_ms: u64) {
        let cutoff = now_millis().saturating_sub(max_age_ms);
        let mut entries = self.entries.lock().unwrap();
        let before = entries.len();
        entries.retain(|e| e.pinned || e.timestamp >= cutoff);
        if entries.len() < before {
            drop(entries);
            self.save_to_disk();
        }
    }

    pub fn push(&self, content: String) -> Option<ClipEntry> {
        let mut entries = self.entries.lock().unwrap();

        // Deduplicate: if the same content already exists, move it to the top
        if let Some(pos) = entries.iter().position(|e| e.content == content) {
            let mut existing = entries.remove(pos);
            existing.timestamp = now_millis();
            entries.insert(0, existing.clone());
            drop(entries);
            self.save_to_disk();
            return Some(existing);
        }

        let entry = ClipEntry {
            id: uuid::Uuid::new_v4().to_string(),
            content,
            pinned: false,
            timestamp: now_millis(),
            shortcut: None,
        };

        entries.insert(0, entry.clone());

        // Trim to max_entries, keeping pinned entries
        let max = self.settings.lock().unwrap().max_entries;
        while entries.len() > max {
            // Remove the oldest non-pinned entry
            if let Some(pos) = entries.iter().rposition(|e| !e.pinned) {
                entries.remove(pos);
            } else {
                break; // All entries are pinned
            }
        }

        drop(entries);
        self.save_to_disk();
        Some(entry)
    }

    pub fn get_all(&self) -> Vec<ClipEntry> {
        self.entries.lock().unwrap().clone()
    }

    pub fn delete(&self, id: &str) -> bool {
        let mut entries = self.entries.lock().unwrap();
        let len_before = entries.len();
        entries.retain(|e| e.id != id);
        let removed = entries.len() < len_before;
        drop(entries);
        if removed {
            self.save_to_disk();
        }
        removed
    }

    pub fn clear(&self) -> usize {
        let mut entries = self.entries.lock().unwrap();
        let before = entries.len();
        entries.retain(|e| e.pinned);
        let removed = before - entries.len();
        drop(entries);
        if removed > 0 {
            self.save_to_disk();
        }
        removed
    }

    pub fn toggle_pin(&self, id: &str) -> Option<bool> {
        let mut entries = self.entries.lock().unwrap();
        if let Some(entry) = entries.iter_mut().find(|e| e.id == id) {
            entry.pinned = !entry.pinned;
            let new_state = entry.pinned;
            drop(entries);
            self.save_to_disk();
            Some(new_state)
        } else {
            None
        }
    }

    /// Set or clear the shortcut for a given entry. Returns Err on duplicate.
    pub fn set_shortcut(&self, id: &str, shortcut: Option<&str>) -> Result<Option<String>, String> {
        let mut entries = self.entries.lock().unwrap();

        // Check for duplicates
        if let Some(sc) = shortcut {
            if let Some(other) = entries.iter().find(|e| e.id != id && e.shortcut.as_deref() == Some(sc)) {
                return Err(format!("Raccourci déjà assigné à un autre clip ({})", &other.content[..other.content.len().min(30)]));
            }
        }

        let entry = entries.iter_mut().find(|e| e.id == id)
            .ok_or_else(|| "Entry not found".to_string())?;
        entry.shortcut = shortcut.map(|s| s.to_string());
        let new_shortcut = entry.shortcut.clone();
        drop(entries);
        self.save_to_disk();
        Ok(new_shortcut)
    }

    /// Get the old shortcut for an entry (before deletion).
    pub fn get_shortcut(&self, id: &str) -> Option<String> {
        self.entries.lock().unwrap().iter()
            .find(|e| e.id == id)
            .and_then(|e| e.shortcut.clone())
    }

    /// Get all entries that have shortcuts assigned.
    pub fn get_shortcutted(&self) -> Vec<ClipEntry> {
        self.entries.lock().unwrap().iter()
            .filter(|e| e.shortcut.is_some())
            .cloned()
            .collect()
    }

    /// Get shortcuts of non-pinned entries (for cleanup before clear).
    pub fn get_non_pinned_shortcuts(&self) -> Vec<String> {
        self.entries.lock().unwrap().iter()
            .filter(|e| !e.pinned && e.shortcut.is_some())
            .filter_map(|e| e.shortcut.clone())
            .collect()
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// ── Global shortcut registration for clip entries ────────────────────

const RESERVED_SHORTCUTS: &[&str] = &["ctrl+l"];

/// Register a global shortcut that pastes a clip entry's content.
#[cfg(not(target_os = "android"))]
pub fn register_clip_shortcut(
    app: &tauri::AppHandle,
    shortcut_str: &str,
    entry_id: String,
    store: Arc<ClipboardHistoryStore>,
) -> Result<(), String> {
    let id = entry_id;
    let st = store;
    app.global_shortcut()
        .on_shortcut(shortcut_str, move |_app, _shortcut, event| {
            if let ShortcutState::Pressed = event.state {
                let entries = st.get_all();
                if let Some(entry) = entries.iter().find(|e| e.id == id) {
                    let content = entry.content.clone();
                    std::thread::spawn(move || {
                        clipboard::SUPPRESS_CLIPBOARD.store(true, std::sync::atomic::Ordering::SeqCst);
                        let _ = clipboard::write_clipboard_text(&content);
                        std::thread::sleep(Duration::from_millis(50));
                        clipboard::simulate_paste();
                        std::thread::sleep(Duration::from_millis(100));
                        clipboard::SUPPRESS_CLIPBOARD.store(false, std::sync::atomic::Ordering::SeqCst);
                    });
                }
            }
        })
        .map_err(|e| format!("Impossible d'enregistrer le raccourci '{}': {}", shortcut_str, e))
}

/// Unregister a global shortcut.
#[cfg(not(target_os = "android"))]
pub fn unregister_clip_shortcut(
    app: &tauri::AppHandle,
    shortcut_str: &str,
) -> Result<(), String> {
    app.global_shortcut()
        .unregister(shortcut_str)
        .map_err(|e| format!("Impossible de désenregistrer le raccourci '{}': {}", shortcut_str, e))
}

// ── Win32 Clipboard Monitor ──────────────────────────────────────────

extern "system" {
    fn CreateWindowExW(
        ex_style: u32, class_name: *const u16, window_name: *const u16,
        style: u32, x: i32, y: i32, w: i32, h: i32,
        parent: isize, menu: isize, instance: isize, param: isize,
    ) -> isize;
    fn DefWindowProcW(hwnd: isize, msg: u32, wparam: usize, lparam: isize) -> isize;
    fn RegisterClassW(wc: *const WndClassW) -> u16;
    fn GetMessageW(msg: *mut RawMsg, hwnd: isize, filter_min: u32, filter_max: u32) -> i32;
    fn TranslateMessage(msg: *const RawMsg) -> i32;
    fn DispatchMessageW(msg: *const RawMsg) -> isize;
    fn AddClipboardFormatListener(hwnd: isize) -> i32;
    fn GetModuleHandleW(name: *const u16) -> isize;
}

const WM_CLIPBOARDUPDATE: u32 = 0x031D;

#[repr(C)]
struct WndClassW {
    style: u32,
    wnd_proc: Option<unsafe extern "system" fn(isize, u32, usize, isize) -> isize>,
    cls_extra: i32,
    wnd_extra: i32,
    instance: isize,
    icon: isize,
    cursor: isize,
    background: isize,
    menu_name: *const u16,
    class_name: *const u16,
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

// Thread-local storage for the store + app handle used in wnd_proc
struct MonitorContext {
    store: Arc<ClipboardHistoryStore>,
    app_handle: tauri::AppHandle,
}

thread_local! {
    static MONITOR_CTX: std::cell::RefCell<Option<MonitorContext>> =
        const { std::cell::RefCell::new(None) };
}

pub fn start_clipboard_monitor(store: Arc<ClipboardHistoryStore>, app_handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        unsafe { run_monitor(store, app_handle) }
    });
}

unsafe fn run_monitor(store: Arc<ClipboardHistoryStore>, app_handle: tauri::AppHandle) {
    MONITOR_CTX.with(|ctx| {
        *ctx.borrow_mut() = Some(MonitorContext {
            store,
            app_handle,
        });
    });

    let class_name: Vec<u16> = "SuperFluxClipboardMonitor\0".encode_utf16().collect();
    let hinstance = GetModuleHandleW(std::ptr::null());

    let wc = WndClassW {
        style: 0,
        wnd_proc: Some(clipboard_wnd_proc),
        cls_extra: 0,
        wnd_extra: 0,
        instance: hinstance,
        icon: 0,
        cursor: 0,
        background: 0,
        menu_name: std::ptr::null(),
        class_name: class_name.as_ptr(),
    };

    let atom = RegisterClassW(&wc);
    if atom == 0 {
        eprintln!("[clipboard_history] Failed to register window class");
        return;
    }

    let hwnd = CreateWindowExW(
        0,
        class_name.as_ptr(),
        class_name.as_ptr(),
        0, 0, 0, 0, 0,
        0, 0, hinstance, 0,
    );

    if hwnd == 0 {
        eprintln!("[clipboard_history] Failed to create message-only window");
        return;
    }

    if AddClipboardFormatListener(hwnd) == 0 {
        eprintln!("[clipboard_history] Failed to add clipboard format listener");
        return;
    }

    eprintln!("[clipboard_history] Clipboard monitor started");

    let mut msg = RawMsg::default();
    while GetMessageW(&mut msg, 0, 0, 0) > 0 {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
}

unsafe extern "system" fn clipboard_wnd_proc(
    hwnd: isize,
    msg: u32,
    wparam: usize,
    lparam: isize,
) -> isize {
    if msg == WM_CLIPBOARDUPDATE {
        // Check suppress flag (snippet expansion in progress)
        if clipboard::SUPPRESS_CLIPBOARD.load(std::sync::atomic::Ordering::Relaxed) {
            return 0;
        }

        // Read clipboard text
        if let Some(text) = clipboard::read_clipboard_text() {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                MONITOR_CTX.with(|ctx| {
                    if let Some(ctx) = ctx.borrow().as_ref() {
                        if let Some(entry) = ctx.store.push(trimmed.to_string()) {
                            // Emit event to frontend
                            use tauri::Emitter;
                            let _ = ctx.app_handle.emit("clipboard-changed", &entry);
                        }
                    }
                });
            }
        }

        return 0;
    }

    DefWindowProcW(hwnd, msg, wparam, lparam)
}

// ── Tauri Commands ───────────────────────────────────────────────────

#[tauri::command]
pub fn get_clipboard_history(
    store: tauri::State<'_, Arc<ClipboardHistoryStore>>,
) -> Vec<ClipEntry> {
    store.get_all()
}

#[tauri::command]
pub fn delete_clip_entry(
    id: String,
    store: tauri::State<'_, Arc<ClipboardHistoryStore>>,
    #[allow(unused)] app: tauri::AppHandle,
) -> bool {
    // Unregister shortcut if any before deleting
    #[cfg(not(target_os = "android"))]
    if let Some(sc) = store.get_shortcut(&id) {
        let _ = unregister_clip_shortcut(&app, &sc);
    }
    store.delete(&id)
}

#[tauri::command]
pub fn clear_clipboard_history(
    store: tauri::State<'_, Arc<ClipboardHistoryStore>>,
    #[allow(unused)] app: tauri::AppHandle,
) -> usize {
    // Unregister shortcuts of non-pinned entries before clearing
    #[cfg(not(target_os = "android"))]
    for sc in store.get_non_pinned_shortcuts() {
        let _ = unregister_clip_shortcut(&app, &sc);
    }
    store.clear()
}

#[tauri::command]
pub fn toggle_pin_clip_entry(
    id: String,
    store: tauri::State<'_, Arc<ClipboardHistoryStore>>,
) -> Option<bool> {
    store.toggle_pin(&id)
}

#[tauri::command]
pub fn paste_clip_entry(
    id: String,
    paste_to_app: Option<bool>,
    store: tauri::State<'_, Arc<ClipboardHistoryStore>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let entries = store.get_all();
    let entry = entries.iter().find(|e| e.id == id)
        .ok_or_else(|| "Entry not found".to_string())?;

    let content = entry.content.clone();

    if paste_to_app.unwrap_or(false) {
        // Minimize SuperFlux so the previous app regains focus, then paste, then restore
        use tauri::Manager;
        let win = app.get_webview_window("main");
        if let Some(ref w) = win {
            let _ = w.minimize();
        }
        std::thread::spawn(move || {
            // Wait for the OS to focus the previous window
            std::thread::sleep(Duration::from_millis(200));
            clipboard::SUPPRESS_CLIPBOARD.store(true, std::sync::atomic::Ordering::SeqCst);
            let _ = clipboard::write_clipboard_text(&content);
            std::thread::sleep(Duration::from_millis(50));
            clipboard::simulate_paste();
            std::thread::sleep(Duration::from_millis(300));
            clipboard::SUPPRESS_CLIPBOARD.store(false, std::sync::atomic::Ordering::SeqCst);
            // Restore the window
            if let Some(w) = win {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        });
    } else {
        // Suppress monitor so re-copying doesn't move the entry to the top
        clipboard::SUPPRESS_CLIPBOARD.store(true, std::sync::atomic::Ordering::SeqCst);
        let result = clipboard::write_clipboard_text(&content);
        std::thread::spawn(|| {
            std::thread::sleep(Duration::from_millis(100));
            clipboard::SUPPRESS_CLIPBOARD.store(false, std::sync::atomic::Ordering::SeqCst);
        });
        result?;
    }

    Ok(())
}

/// Set or clear a global shortcut for a clip entry.
/// shortcut = Some("ctrl+shift+1") to assign, None to remove.
#[tauri::command]
pub fn set_clip_shortcut(
    id: String,
    shortcut: Option<String>,
    store: tauri::State<'_, Arc<ClipboardHistoryStore>>,
    #[allow(unused)] app: tauri::AppHandle,
) -> Result<Option<String>, String> {
    // Validate: not a reserved shortcut
    if let Some(ref sc) = shortcut {
        let lower = sc.to_lowercase();
        if RESERVED_SHORTCUTS.contains(&lower.as_str()) {
            return Err(format!("Le raccourci '{}' est réservé par le système", sc));
        }
    }

    // Get old shortcut to unregister
    let old_shortcut = store.get_shortcut(&id);

    // Unregister old shortcut if any
    #[cfg(not(target_os = "android"))]
    if let Some(ref old_sc) = old_shortcut {
        let _ = unregister_clip_shortcut(&app, old_sc);
    }

    // Update store
    let result = store.set_shortcut(&id, shortcut.as_deref())?;

    // Register new shortcut if any
    #[cfg(not(target_os = "android"))]
    if let Some(ref new_sc) = result {
        let store_arc: Arc<ClipboardHistoryStore> = Arc::clone(&store);
        register_clip_shortcut(&app, new_sc, id, store_arc)?;
    }

    Ok(result)
}

#[tauri::command]
pub fn get_clipboard_settings(
    store: tauri::State<'_, Arc<ClipboardHistoryStore>>,
) -> ClipboardSettings {
    store.get_settings()
}

#[tauri::command]
pub fn set_clipboard_settings(
    max_entries: usize,
    retention_ms: u64,
    store: tauri::State<'_, Arc<ClipboardHistoryStore>>,
) -> ClipboardSettings {
    store.update_settings(max_entries, retention_ms);
    store.get_settings()
}
