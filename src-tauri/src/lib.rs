use reqwest::header::{HeaderMap, HeaderName, HeaderValue, ACCEPT, USER_AGENT};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
#[cfg(not(target_os = "android"))]
use tauri::{LogicalSize, PhysicalPosition, PhysicalSize};
#[cfg(not(target_os = "android"))]
use tauri::window::{Color, Effect, EffectState, EffectsBuilder};
use tauri::Manager;
use url::Url;

const RSS_USER_AGENT: &str = "SuperFlux/1.0 (RSS Reader; +https://github.com/user/superflux)";

/// Force DWM to repaint the window backdrop (Mica/Acrylic/Blur).
/// Without this, Windows drops the effect on move/resize.
#[cfg(target_os = "windows")]
fn force_dwm_repaint(window: &tauri::WebviewWindow) {
    extern "system" {
        fn SetWindowPos(
            hwnd: isize, after: isize,
            x: i32, y: i32, cx: i32, cy: i32, flags: u32,
        ) -> i32;
    }
    const SWP_NOMOVE: u32 = 0x0002;
    const SWP_NOSIZE: u32 = 0x0001;
    const SWP_NOZORDER: u32 = 0x0004;
    const SWP_FRAMECHANGED: u32 = 0x0020;
    const SWP_NOACTIVATE: u32 = 0x0010;

    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            SetWindowPos(
                hwnd.0 as isize, 0, 0, 0, 0, 0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED | SWP_NOACTIVATE,
            );
        }
    }
}

/// Track whether a window effect is active so we know to repaint on move.
#[cfg(not(target_os = "android"))]
static EFFECT_ACTIVE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
const BROWSER_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
#[cfg(not(target_os = "android"))]
const COLLAPSED_HEIGHT: f64 = 52.0;

#[cfg(not(target_os = "android"))]
struct SavedGeometry {
    size: PhysicalSize<u32>,
    pos: PhysicalPosition<i32>,
}

struct AppState {
    #[cfg(not(target_os = "android"))]
    saved: Mutex<Option<SavedGeometry>>,
}

// Shared HTTP client — created once, reused for all requests (connection pooling)
static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn get_or_init_client() -> Result<&'static reqwest::Client, String> {
    if let Some(c) = HTTP_CLIENT.get() {
        return Ok(c);
    }
    eprintln!("[http] Initializing shared HTTP client...");
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(std::time::Duration::from_secs(30))
        .connect_timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;
    eprintln!("[http] Shared HTTP client initialized OK");
    let _ = HTTP_CLIENT.set(client);
    Ok(HTTP_CLIENT.get().unwrap())
}

fn get_headers_for_url(url: &Url) -> HeaderMap {
    let mut headers = HeaderMap::new();
    let host = url.host_str().unwrap_or("");

    if host.contains("reddit.com") {
        // Reddit blocks non-browser User-Agents with 403
        headers.insert(USER_AGENT, HeaderValue::from_static(BROWSER_USER_AGENT));
        headers.insert(
            ACCEPT,
            HeaderValue::from_static(
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            ),
        );
        headers.insert(
            "Accept-Language",
            HeaderValue::from_static("en-US,en;q=0.9,fr;q=0.8"),
        );
    } else if host.contains("youtube.com") {
        headers.insert(USER_AGENT, HeaderValue::from_static(RSS_USER_AGENT));
        headers.insert(
            ACCEPT,
            HeaderValue::from_static("application/atom+xml, application/xml, text/xml, */*"),
        );
    } else {
        headers.insert(USER_AGENT, HeaderValue::from_static(BROWSER_USER_AGENT));
        headers.insert(
            ACCEPT,
            HeaderValue::from_static(
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            ),
        );
        headers.insert(
            "Accept-Language",
            HeaderValue::from_static("en-US,en;q=0.9,fr;q=0.8"),
        );
    }

    headers
}

/// Quick network connectivity check — returns diagnostic info
#[tauri::command]
async fn check_network() -> Result<String, String> {
    eprintln!("[check_network] Running network diagnostic...");

    let client = get_or_init_client()?;

    // Test 1: simple HTTPS GET
    let test_url = "https://httpbin.org/get";
    match client.get(test_url).send().await {
        Ok(resp) => {
            let status = resp.status();
            eprintln!("[check_network] {test_url} → {status}");
            Ok(format!("OK: {test_url} → HTTP {status}"))
        }
        Err(e) => {
            let msg = format!("{test_url} → {e}");
            eprintln!("[check_network] FAIL: {msg}");
            // Try to give more detail
            if e.is_connect() {
                Err(format!("Connection failed (DNS or firewall?): {e}"))
            } else if e.is_timeout() {
                Err(format!("Timeout: {e}"))
            } else if e.is_request() {
                Err(format!("TLS/Request error: {e}"))
            } else {
                Err(format!("Network error: {e}"))
            }
        }
    }
}

#[tauri::command]
async fn fetch_url(target_url: String) -> Result<String, String> {
    eprintln!("[fetch_url] Fetching: {target_url}");

    let parsed = Url::parse(&target_url).map_err(|e| {
        eprintln!("[fetch_url] Invalid URL: {e}");
        format!("Invalid URL: {e}")
    })?;
    let headers = get_headers_for_url(&parsed);

    let client = get_or_init_client()?;

    let response = client
        .get(&target_url)
        .headers(headers)
        .send()
        .await
        .map_err(|e| {
            let detail = if e.is_connect() {
                format!("Connection failed: {e}")
            } else if e.is_timeout() {
                format!("Timeout: {e}")
            } else if e.is_request() {
                format!("TLS/Request error: {e}")
            } else {
                format!("Request failed: {e}")
            };
            eprintln!("[fetch_url] {detail} for {target_url}");
            detail
        })?;

    let status = response.status();
    eprintln!("[fetch_url] Response status: {status} for {target_url}");

    if !status.is_success() {
        return Err(format!("HTTP {}", status.as_u16()));
    }

    response
        .text()
        .await
        .map_err(|e| {
            eprintln!("[fetch_url] Failed to read body for {target_url}: {e}");
            format!("Failed to read response body: {e}")
        })
}

#[derive(Serialize)]
struct HttpResponse {
    status: u16,
    body: String,
    headers: HashMap<String, String>,
}

#[tauri::command]
async fn http_request(
    method: String,
    url: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<HttpResponse, String> {
    let client = get_or_init_client()?;

    let mut req = match method.to_uppercase().as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "DELETE" => client.delete(&url),
        "PATCH" => client.patch(&url),
        other => return Err(format!("Unsupported HTTP method: {other}")),
    };

    // Apply custom headers
    for (key, value) in &headers {
        let header_name = HeaderName::try_from(key.as_str())
            .map_err(|e| format!("Invalid header name '{key}': {e}"))?;
        let header_value = HeaderValue::from_str(value)
            .map_err(|e| format!("Invalid header value for '{key}': {e}"))?;
        req = req.header(header_name, header_value);
    }

    // Set User-Agent if not already provided
    if !headers.keys().any(|k| k.eq_ignore_ascii_case("user-agent")) {
        req = req.header(USER_AGENT, BROWSER_USER_AGENT);
    }

    // Set body if provided
    if let Some(body_str) = body {
        req = req.body(body_str);
    }

    let response = req
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    let status = response.status().as_u16();
    let resp_headers: HashMap<String, String> = response
        .headers()
        .iter()
        .map(|(k, v)| (k.as_str().to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    let resp_body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {e}"))?;

    Ok(HttpResponse {
        status,
        body: resp_body,
        headers: resp_headers,
    })
}

#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    open::that(&url).map_err(|e| format!("Failed to open URL: {e}"))
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn collapse_window(window: tauri::WebviewWindow, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let size = window.outer_size().map_err(|e| format!("outer_size: {e}"))?;
    let pos = window.outer_position().map_err(|e| format!("outer_position: {e}"))?;
    let factor = window.scale_factor().map_err(|e| format!("scale_factor: {e}"))?;

    eprintln!("[collapse] outer_size={}x{}, pos=({},{}), factor={}", size.width, size.height, pos.x, pos.y, factor);

    // Save current geometry
    *state.saved.lock().unwrap() = Some(SavedGeometry { size, pos });

    let logical_w = size.width as f64 / factor;

    // Lower min size, then resize
    window
        .set_min_size(Some(LogicalSize::new(200.0, COLLAPSED_HEIGHT)))
        .map_err(|e| format!("set_min_size: {e}"))?;

    eprintln!("[collapse] set_min_size OK, now set_size to {}x{}", logical_w, COLLAPSED_HEIGHT);

    window
        .set_size(tauri::Size::Logical(LogicalSize::new(logical_w, COLLAPSED_HEIGHT)))
        .map_err(|e| format!("set_size: {e}"))?;

    eprintln!("[collapse] set_size OK");
    Ok(())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn expand_window(window: tauri::WebviewWindow, state: tauri::State<'_, AppState>) -> Result<(), String> {
    eprintln!("[expand] restoring window");

    let saved = state.saved.lock().unwrap().take();
    if let Some(geo) = saved {
        // Restore size first (it might be larger than current min)
        window
            .set_min_size(Some(LogicalSize::new(900.0, 600.0)))
            .map_err(|e| format!("set_min_size: {e}"))?;
        window
            .set_size(geo.size)
            .map_err(|e| format!("set_size: {e}"))?;
        window
            .set_position(geo.pos)
            .map_err(|e| format!("set_position: {e}"))?;
        eprintln!("[expand] restored to {}x{}", geo.size.width, geo.size.height);
    } else {
        window
            .set_min_size(Some(LogicalSize::new(900.0, 600.0)))
            .map_err(|e| format!("set_min_size: {e}"))?;
        window
            .set_size(LogicalSize::new(1280.0, 800.0))
            .map_err(|e| format!("set_size: {e}"))?;
        eprintln!("[expand] restored to default 1280x800");
    }

    Ok(())
}

#[cfg(target_os = "android")]
#[tauri::command]
fn collapse_window() -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "android")]
#[tauri::command]
fn expand_window() -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn set_window_effect(
    window: tauri::WebviewWindow,
    effect: String,
    r: u8,
    g: u8,
    b: u8,
    a: u8,
) -> Result<(), String> {
    eprintln!("[set_window_effect] effect={effect}, color=({r},{g},{b},{a})");

    if effect == "none" {
        EFFECT_ACTIVE.store(false, std::sync::atomic::Ordering::Relaxed);
        window
            .set_effects(EffectsBuilder::new().build())
            .map_err(|e| format!("clear effects: {e}"))?;
    } else {
        let eff = match effect.as_str() {
            "mica" => Effect::Mica,
            "mica-dark" => Effect::MicaDark,
            "mica-light" => Effect::MicaLight,
            "acrylic" => Effect::Acrylic,
            "tabbed" => Effect::Tabbed,
            "blur" => Effect::Blur,
            other => return Err(format!("Unknown effect: {other}")),
        };
        window
            .set_effects(
                EffectsBuilder::new()
                    .effect(eff)
                    .state(EffectState::Active)
                    .color(Color(r, g, b, a))
                    .build(),
            )
            .map_err(|e| format!("set_effects: {e}"))?;
        EFFECT_ACTIVE.store(true, std::sync::atomic::Ordering::Relaxed);
    }

    #[cfg(target_os = "windows")]
    force_dwm_repaint(&window);

    eprintln!("[set_window_effect] Effect {effect} applied OK");
    Ok(())
}

#[cfg(target_os = "android")]
#[tauri::command]
fn set_window_effect(
    _effect: String,
    _r: u8,
    _g: u8,
    _b: u8,
    _a: u8,
) -> Result<(), String> {
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            #[cfg(not(target_os = "android"))]
            saved: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![fetch_url, http_request, open_external, collapse_window, expand_window, check_network, set_window_effect])
        .setup(|_app| {
            #[cfg(not(target_os = "android"))]
            {
                let window = _app.get_webview_window("main").expect("main window not found");
                window.set_minimizable(true).ok();
                window.set_maximizable(true).ok();
                window.set_closable(true).ok();

                // Re-apply DWM backdrop after every move/resize so the effect persists
                #[cfg(target_os = "windows")]
                {
                    let win = window.clone();
                    window.on_window_event(move |event| {
                        match event {
                            tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
                                if EFFECT_ACTIVE.load(std::sync::atomic::Ordering::Relaxed) {
                                    force_dwm_repaint(&win);
                                }
                            }
                            _ => {}
                        }
                    });
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
