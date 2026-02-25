use base64::{Engine, engine::general_purpose::STANDARD};
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
fn get_cpu_usage() -> f32 {
    use sysinfo::System;
    static SYS: OnceLock<Mutex<System>> = OnceLock::new();
    let mtx = SYS.get_or_init(|| {
        let mut sys = System::new();
        sys.refresh_cpu_usage();
        Mutex::new(sys)
    });
    let mut sys = mtx.lock().unwrap();
    sys.refresh_cpu_usage();
    sys.global_cpu_usage()
}

#[derive(Serialize)]
struct MemoryInfo {
    used_gb: f64,
    total_gb: f64,
    percent: f32,
}

#[tauri::command]
fn get_memory_usage() -> MemoryInfo {
    use sysinfo::System;
    let mut sys = System::new();
    sys.refresh_memory();
    let total = sys.total_memory() as f64;
    let used = sys.used_memory() as f64;
    let gb = 1_073_741_824.0; // 1 GiB
    MemoryInfo {
        used_gb: (used / gb * 10.0).round() / 10.0,
        total_gb: (total / gb * 10.0).round() / 10.0,
        percent: if total > 0.0 { (used / total * 100.0) as f32 } else { 0.0 },
    }
}

#[derive(Serialize)]
struct NetSpeed {
    download_kbps: f64,
    upload_kbps: f64,
}

#[tauri::command]
fn get_net_speed() -> NetSpeed {
    use sysinfo::Networks;
    use std::time::Instant;

    static NET: OnceLock<Mutex<(Networks, Instant, u64, u64)>> = OnceLock::new();
    let mtx = NET.get_or_init(|| {
        let mut nets = Networks::new_with_refreshed_list();
        nets.refresh();
        let (rx, tx) = nets.iter().fold((0u64, 0u64), |(r, t), (_name, data)| {
            (r + data.total_received(), t + data.total_transmitted())
        });
        Mutex::new((nets, Instant::now(), rx, tx))
    });

    let mut guard = mtx.lock().unwrap();
    let (ref mut nets, ref mut last_time, ref mut last_rx, ref mut last_tx) = *guard;

    nets.refresh();
    let now = Instant::now();
    let elapsed = now.duration_since(*last_time);
    let secs = elapsed.as_secs_f64().max(0.1);

    let (rx, tx) = nets.iter().fold((0u64, 0u64), |(r, t), (_name, data)| {
        (r + data.total_received(), t + data.total_transmitted())
    });

    let dl = (rx.saturating_sub(*last_rx) as f64) / secs / 1024.0; // KB/s
    let ul = (tx.saturating_sub(*last_tx) as f64) / secs / 1024.0;

    *last_time = now;
    *last_rx = rx;
    *last_tx = tx;

    NetSpeed {
        download_kbps: (dl * 10.0).round() / 10.0,
        upload_kbps: (ul * 10.0).round() / 10.0,
    }
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

// ── TTS (native) ──────────────────────────────────────────────────────

#[cfg(not(target_os = "android"))]
static TTS_INSTANCE: OnceLock<Mutex<Option<tts::Tts>>> = OnceLock::new();

#[cfg(not(target_os = "android"))]
fn get_tts_lock() -> &'static Mutex<Option<tts::Tts>> {
    TTS_INSTANCE.get_or_init(|| Mutex::new(None))
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn tts_speak(text: String, rate: Option<f32>) -> Result<(), String> {
    let mut guard = get_tts_lock().lock().map_err(|e| format!("TTS lock: {e}"))?;
    let tts = match guard.as_mut() {
        Some(t) => t,
        None => {
            let instance = tts::Tts::default().map_err(|e| format!("TTS init: {e}"))?;
            *guard = Some(instance);
            guard.as_mut().unwrap()
        }
    };
    if let Some(r) = rate {
        let min = tts.min_rate();
        let max = tts.max_rate();
        let normal = tts.normal_rate();
        let clamped = r.clamp(0.5, 2.0);
        let mapped = if clamped <= 1.0 {
            let t = (clamped - 0.5) / 0.5;
            min + t * (normal - min)
        } else {
            let t = (clamped - 1.0) / 1.0;
            normal + t * (max - normal)
        };
        tts.set_rate(mapped).map_err(|e| format!("TTS rate: {e}"))?;
    }
    tts.speak(text, true).map_err(|e| format!("TTS speak: {e}"))?;
    Ok(())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
fn tts_stop() -> Result<(), String> {
    let mut guard = get_tts_lock().lock().map_err(|e| format!("TTS lock: {e}"))?;
    if let Some(tts) = guard.as_mut() {
        tts.stop().map_err(|e| format!("TTS stop: {e}"))?;
    }
    Ok(())
}

#[cfg(target_os = "android")]
#[tauri::command]
fn tts_speak(_text: String, _rate: Option<f32>) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "android")]
#[tauri::command]
fn tts_stop() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
async fn tts_speak_elevenlabs(
    text: String,
    api_key: String,
    voice_id: String,
    model_id: Option<String>,
) -> Result<String, String> {
    let client = get_or_init_client()?;
    let url = format!(
        "https://api.elevenlabs.io/v1/text-to-speech/{}?output_format=mp3_44100_128",
        voice_id
    );
    let model = model_id.unwrap_or_else(|| "eleven_multilingual_v2".to_string());
    eprintln!("[elevenlabs] voice={voice_id}, model={model}, text_len={}", text.len());

    let body = serde_json::json!({
        "text": text,
        "model_id": model,
    });

    let response = client
        .post(&url)
        .header("xi-api-key", &api_key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            eprintln!("[elevenlabs] Request failed: {e}");
            format!("ElevenLabs request failed: {e}")
        })?;

    let status = response.status();
    eprintln!("[elevenlabs] Response status: {status}");
    if !status.is_success() {
        let err_body = response.text().await.unwrap_or_default();
        eprintln!("[elevenlabs] Error body: {err_body}");
        return Err(format!("ElevenLabs HTTP {status}: {err_body}"));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("ElevenLabs read body: {e}"))?;

    eprintln!("[elevenlabs] Audio received: {} bytes", bytes.len());
    Ok(STANDARD.encode(&bytes))
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
async fn open_auth_window(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri::{Emitter, WebviewUrl, WebviewWindowBuilder};

    // Close any existing auth window
    if let Some(existing) = app.get_webview_window("auth") {
        let _ = existing.close();
    }

    let parsed_url: Url = url.parse().map_err(|e: url::ParseError| format!("Invalid URL: {e}"))?;
    let app_handle = app.clone();

    WebviewWindowBuilder::new(&app, "auth", WebviewUrl::External(parsed_url))
        .title("Sign in")
        .inner_size(500.0, 700.0)
        .on_navigation(move |nav_url| {
            let url_str = nav_url.as_str();
            // Intercept redirect to our callback URL
            if url_str.starts_with("http://localhost/auth/callback") {
                let _ = app_handle.emit("auth-callback", url_str.to_string());
                return false; // Block navigation to localhost
            }
            true
        })
        .build()
        .map_err(|e| format!("Failed to create auth window: {e}"))?;

    Ok(())
}

#[cfg(target_os = "android")]
#[tauri::command]
async fn open_auth_window(_url: String) -> Result<(), String> {
    Ok(())
}

// ── Pandoc integration ───────────────────────────────────────────────

#[tauri::command]
fn pandoc_check() -> Result<String, String> {
    let output = std::process::Command::new("pandoc")
        .arg("--version")
        .output()
        .map_err(|e| format!("pandoc not found: {e}"))?;
    if !output.status.success() {
        return Err("pandoc exited with error".to_string());
    }
    let version = String::from_utf8_lossy(&output.stdout);
    let first_line = version.lines().next().unwrap_or("pandoc");
    Ok(first_line.to_string())
}

#[tauri::command]
fn pandoc_import(base64_data: String, filename: String) -> Result<String, String> {
    let bytes = STANDARD.decode(&base64_data)
        .map_err(|e| format!("base64 decode error: {e}"))?;

    let tmp_dir = std::env::temp_dir().join("superflux_pandoc");
    std::fs::create_dir_all(&tmp_dir)
        .map_err(|e| format!("Failed to create temp dir: {e}"))?;

    let input_path = tmp_dir.join(&filename);
    std::fs::write(&input_path, &bytes)
        .map_err(|e| format!("Failed to write temp file: {e}"))?;

    let output = std::process::Command::new("pandoc")
        .arg(input_path.to_str().unwrap())
        .arg("-t").arg("html")
        .arg("--wrap=none")
        .output()
        .map_err(|e| format!("pandoc execution failed: {e}"))?;

    // Clean up temp file
    let _ = std::fs::remove_file(&input_path);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("pandoc error: {stderr}"));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
fn pandoc_export(html_content: String, format: String) -> Result<String, String> {
    let tmp_dir = std::env::temp_dir().join("superflux_pandoc");
    std::fs::create_dir_all(&tmp_dir)
        .map_err(|e| format!("Failed to create temp dir: {e}"))?;

    let input_path = tmp_dir.join("export_input.html");
    let ext = match format.as_str() {
        "docx" => "docx",
        "pdf" => "pdf",
        other => return Err(format!("Unsupported format: {other}")),
    };
    let output_path = tmp_dir.join(format!("export_output.{ext}"));

    std::fs::write(&input_path, &html_content)
        .map_err(|e| format!("Failed to write temp file: {e}"))?;

    let output = std::process::Command::new("pandoc")
        .arg(input_path.to_str().unwrap())
        .arg("-f").arg("html")
        .arg("-t").arg(&format)
        .arg("-o").arg(output_path.to_str().unwrap())
        .output()
        .map_err(|e| format!("pandoc execution failed: {e}"))?;

    let _ = std::fs::remove_file(&input_path);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let _ = std::fs::remove_file(&output_path);
        return Err(format!("pandoc error: {stderr}"));
    }

    let result_bytes = std::fs::read(&output_path)
        .map_err(|e| format!("Failed to read output file: {e}"))?;
    let _ = std::fs::remove_file(&output_path);

    Ok(STANDARD.encode(&result_bytes))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            #[cfg(not(target_os = "android"))]
            saved: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![fetch_url, http_request, open_external, get_cpu_usage, get_memory_usage, get_net_speed, collapse_window, expand_window, check_network, set_window_effect, tts_speak, tts_stop, tts_speak_elevenlabs, open_auth_window, pandoc_check, pandoc_import, pandoc_export])
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
