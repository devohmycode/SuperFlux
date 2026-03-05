use std::sync::atomic::AtomicBool;

/// When `true`, clipboard updates should be suppressed (used during snippet expansion).
pub static SUPPRESS_CLIPBOARD: AtomicBool = AtomicBool::new(false);

const CF_UNICODETEXT: u32 = 13;
const GMEM_MOVEABLE: u32 = 0x0002;

const INPUT_KEYBOARD: u32 = 1;
const KEYEVENTF_KEYUP: u32 = 0x0002;
const VK_CONTROL: u16 = 0x11;
const VK_V: u16 = 0x56;

extern "system" {
    fn OpenClipboard(hwnd: isize) -> i32;
    fn CloseClipboard() -> i32;
    fn GetClipboardData(format: u32) -> isize;
    fn EmptyClipboard() -> i32;
    fn SetClipboardData(format: u32, hmem: isize) -> isize;
    fn GlobalAlloc(flags: u32, bytes: usize) -> isize;
    fn GlobalLock(hmem: isize) -> *mut u8;
    fn GlobalUnlock(hmem: isize) -> i32;
    fn GlobalSize(hmem: isize) -> usize;
    fn SendInput(count: u32, inputs: *const KeyInput, size: i32) -> u32;
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

/// Simulate Ctrl+V keystroke via Win32 SendInput.
pub fn simulate_paste() {
    let paste = [
        make_key_input(VK_CONTROL, 0),
        make_key_input(VK_V, 0),
        make_key_input(VK_V, KEYEVENTF_KEYUP),
        make_key_input(VK_CONTROL, KEYEVENTF_KEYUP),
    ];
    let input_size = std::mem::size_of::<KeyInput>() as i32;
    unsafe {
        SendInput(4, paste.as_ptr(), input_size);
    }
}

/// Read the current clipboard text. Returns `None` if clipboard is empty or not text.
pub unsafe fn read_clipboard_text() -> Option<String> {
    if OpenClipboard(0) == 0 {
        return None;
    }

    let result = (|| {
        let handle = GetClipboardData(CF_UNICODETEXT);
        if handle == 0 {
            return None;
        }
        let size = GlobalSize(handle);
        if size == 0 {
            return None;
        }
        let ptr = GlobalLock(handle);
        if ptr.is_null() {
            return None;
        }
        let wide_len = size / 2;
        let slice = std::slice::from_raw_parts(ptr as *const u16, wide_len);
        let text = String::from_utf16_lossy(slice);
        GlobalUnlock(handle);
        Some(text.trim_end_matches('\0').to_string())
    })();

    CloseClipboard();
    result
}

/// Write text to the clipboard.
pub fn write_clipboard_text(text: &str) -> Result<(), String> {
    unsafe {
        if OpenClipboard(0) == 0 {
            return Err("Failed to open clipboard".into());
        }

        EmptyClipboard();

        let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
        let byte_size = wide.len() * 2;
        let hmem = GlobalAlloc(GMEM_MOVEABLE, byte_size);
        if hmem == 0 {
            CloseClipboard();
            return Err("Failed to allocate global memory".into());
        }

        let ptr = GlobalLock(hmem);
        if ptr.is_null() {
            CloseClipboard();
            return Err("Failed to lock global memory".into());
        }
        std::ptr::copy_nonoverlapping(wide.as_ptr() as *const u8, ptr, byte_size);
        GlobalUnlock(hmem);

        if SetClipboardData(CF_UNICODETEXT, hmem) == 0 {
            CloseClipboard();
            return Err("Failed to set clipboard data".into());
        }

        CloseClipboard();
        Ok(())
    }
}
