use reqwest::header::{HeaderMap, HeaderName, HeaderValue, ACCEPT, USER_AGENT};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{LogicalSize, Manager, PhysicalPosition, PhysicalSize};
use url::Url;

const RSS_USER_AGENT: &str = "SuperFlux/1.0 (RSS Reader; +https://github.com/user/superflux)";
const BROWSER_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const COLLAPSED_HEIGHT: f64 = 52.0;

struct SavedGeometry {
    size: PhysicalSize<u32>,
    pos: PhysicalPosition<i32>,
}

struct AppState {
    saved: Mutex<Option<SavedGeometry>>,
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

#[tauri::command]
async fn fetch_url(target_url: String) -> Result<String, String> {
    let parsed = Url::parse(&target_url).map_err(|e| format!("Invalid URL: {e}"))?;
    let headers = get_headers_for_url(&parsed);

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let response = client
        .get(&target_url)
        .headers(headers)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status().as_u16()));
    }

    response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {e}"))
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
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            saved: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![fetch_url, http_request, open_external, collapse_window, expand_window])
        .setup(|app| {
            let window = app.get_webview_window("main").expect("main window not found");
            window.set_minimizable(true).ok();
            window.set_maximizable(true).ok();
            window.set_closable(true).ok();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
