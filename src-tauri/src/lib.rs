use serde::Deserialize;
use std::collections::HashMap;
use tauri::image::Image;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Listener, LogicalSize, Manager, PhysicalPosition, PhysicalSize, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

mod tray_icon_rgba;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Sub2apiRequest {
    url: String,
    headers: HashMap<String, String>,
    method: Option<String>,
    body: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct TrayStatusImage {
    rgba: Vec<u8>,
    width: u32,
    height: u32,
}

const MAX_TRAY_STATUS_WIDTH: u32 = 1024;
const MAX_TRAY_STATUS_HEIGHT: u32 = 128;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![sub2api_request, tray_command, set_tray_status_image, platform_is_visible])
        .setup(|app| {
            let handle = app.handle().clone();
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_always_on_top(true);
                let _ = window.set_decorations(false);
                let _ = window.set_shadow(false);
                let _ = window.set_size(LogicalSize::new(184.0, 132.0));
            }

            let update_window_handle = app.handle().clone();
            app.listen("token-orb-open-update", move |_| {
                open_update_window(&update_window_handle);
            });

            TrayIconBuilder::with_id("main")
                .icon(Image::new(
                    tray_icon_rgba::TRAY_ICON_RGBA,
                    tray_icon_rgba::TRAY_ICON_WIDTH,
                    tray_icon_rgba::TRAY_ICON_HEIGHT,
                ))
                .show_menu_on_left_click(false)
                .tooltip("Token Orb")
                .on_tray_icon_event(move |_tray, event| {
                    if let TrayIconEvent::Click {
                        button,
                        button_state,
                        rect,
                        ..
                    } = event
                    {
                        if button_state != MouseButtonState::Up {
                            return;
                        }
                        match button {
                            MouseButton::Left => toggle_monitor(&handle, Some(rect)),
                            MouseButton::Right => open_tray_menu(&handle, rect),
                            _ => {}
                        }
                    }
                })
                .build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running token orb");
}

#[tauri::command]
fn platform_is_visible(app: AppHandle) -> bool {
    app.get_webview_window("platform")
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false)
}

#[tauri::command]
fn set_tray_status_image(
    app: AppHandle,
    image: Option<TrayStatusImage>,
    tooltip: String,
) -> Result<(), String> {
    let tray = app
        .tray_by_id("main")
        .ok_or_else(|| "Token Orb 状态栏图标尚未初始化".to_string())?;
    let tooltip = tooltip.trim();
    tray.set_tooltip(Some(if tooltip.is_empty() { "Token Orb" } else { tooltip }))
        .map_err(|error| format!("更新状态栏提示失败: {error}"))?;

    if let Some(image) = image {
        validate_tray_status_image(image.width, image.height, &image.rgba)?;
        #[cfg(target_os = "macos")]
        {
            tray.set_icon(Some(Image::new_owned(image.rgba, image.width, image.height)))
                .map_err(|error| format!("更新状态栏图像失败: {error}"))?;
        }
    } else {
        #[cfg(target_os = "macos")]
        {
            tray.set_icon(Some(Image::new(
                tray_icon_rgba::TRAY_ICON_RGBA,
                tray_icon_rgba::TRAY_ICON_WIDTH,
                tray_icon_rgba::TRAY_ICON_HEIGHT,
            )))
            .map_err(|error| format!("恢复默认状态栏图标失败: {error}"))?;
        }
    }

    Ok(())
}

fn validate_tray_status_image(width: u32, height: u32, rgba: &[u8]) -> Result<(), String> {
    if width == 0 || height == 0 {
        return Err("状态栏图像尺寸必须大于 0".to_string());
    }
    if width > MAX_TRAY_STATUS_WIDTH || height > MAX_TRAY_STATUS_HEIGHT {
        return Err(format!(
            "状态栏图像尺寸超过限制: {width}x{height}"
        ));
    }
    let expected_len = (width as usize)
        .checked_mul(height as usize)
        .and_then(|value| value.checked_mul(4))
        .ok_or_else(|| "状态栏图像尺寸溢出".to_string())?;
    if rgba.len() != expected_len {
        return Err(format!(
            "状态栏 RGBA 长度不匹配: 期望 {expected_len}，实际 {}",
            rgba.len()
        ));
    }
    if !rgba.chunks_exact(4).any(|pixel| pixel[3] > 0) {
        return Err("状态栏图像不能完全透明".to_string());
    }
    Ok(())
}

#[tauri::command]
fn tray_command(app: AppHandle, command: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("tray-menu") {
        let _ = window.hide();
    }

    match command.as_str() {
        "monitor" => {
            let tray_rect = app
                .tray_by_id("main")
                .and_then(|tray| tray.rect().ok().flatten());
            toggle_monitor(&app, tray_rect);
        }
        "settings" => open_settings(&app),
        "update" => open_update_window(&app),
        "quit" => app.exit(0),
        _ => return Err(format!("未知托盘命令: {command}")),
    }

    Ok(())
}

#[tauri::command]
async fn sub2api_request(request: Sub2apiRequest) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let method = request.method.as_deref().unwrap_or("GET").to_ascii_uppercase();
    let mut builder = match method.as_str() {
        "POST" => client.post(&request.url),
        "GET" => client.get(&request.url),
        _ => return Err(format!("sub2api 不支持的请求方法: {method}")),
    };

    if reqwest::Url::parse(&request.url)
        .map(|url| url.path().ends_with("/api/v1/admin/usage"))
        .unwrap_or(false)
    {
        builder = builder.timeout(std::time::Duration::from_secs(20));
    }

    for (key, value) in request.headers {
        builder = builder.header(key, value);
    }
    if let Some(body) = request.body {
        builder = builder.json(&body);
    }

    let response = builder
        .send()
        .await
        .map_err(|error| format!("sub2api 请求失败: {error}"))?;
    let status = response.status();

    if !status.is_success() {
        let detail = response.text().await.unwrap_or_default();
        return Err(format_sub2api_http_error(status.as_u16(), &detail));
    }

    response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("sub2api 响应解析失败: {error}"))
}

fn format_sub2api_http_error(status: u16, detail: &str) -> String {
    let message = read_sub2api_error_detail(detail);
    if status == 401 || status == 403 {
        if message.is_empty() {
            return format!("认证失败，Token 错误或已失效（HTTP {status}）");
        }
        return format!("认证失败，Token 错误或已失效：{message}");
    }

    if message.is_empty() {
        return format!("sub2api 请求失败: HTTP {status}");
    }
    format!("sub2api 请求失败（HTTP {status}）：{message}")
}

fn read_sub2api_error_detail(detail: &str) -> String {
    let trimmed = detail.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(message) = read_error_message(&value) {
            return message;
        }
    }

    trimmed.to_string()
}

fn read_error_message(value: &serde_json::Value) -> Option<String> {
    if let Some(message) = value.as_str().map(str::trim).filter(|message| !message.is_empty()) {
        return Some(message.to_string());
    }

    let object = value.as_object()?;
    for key in ["message", "error", "detail", "msg"] {
        if let Some(message) = object.get(key).and_then(read_error_message) {
            return Some(message);
        }
    }
    None
}

fn toggle_monitor<R: Runtime>(app: &AppHandle<R>, tray_rect: Option<tauri::Rect>) {
    if let Some(window) = app.get_webview_window("platform") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
            let _ = app.emit_to("main", "token-orb-platform-visibility", false);
        } else {
            position_monitor(app, &window, tray_rect);
            let _ = window.show();
            let _ = window.set_focus();
            let _ = window.emit("token-orb-check-platform-update", ());
            let _ = app.emit_to("main", "token-orb-platform-visibility", true);
        }
        return;
    }

    let window = WebviewWindowBuilder::new(app, "platform", WebviewUrl::App("index.html?view=platform".into()))
        .title("Token Orb 平台信息")
        .inner_size(410.0, 300.0)
        .resizable(false)
        .decorations(false)
        .transparent(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .build();

    if let Ok(window) = window {
        position_monitor(app, &window, tray_rect);
        let _ = window.show();
        let _ = window.set_focus();
        let _ = app.emit_to("main", "token-orb-platform-visibility", true);
    }
}

fn open_tray_menu<R: Runtime>(app: &AppHandle<R>, tray_rect: tauri::Rect) {
    if let Some(window) = app.get_webview_window("tray-menu") {
        position_tray_menu(app, &window, &tray_rect);
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }

    let window = WebviewWindowBuilder::new(app, "tray-menu", WebviewUrl::App("index.html?view=tray-menu".into()))
        .title("Token Orb 菜单")
        .inner_size(250.0, 238.0)
        .resizable(false)
        .decorations(false)
        .transparent(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(true)
        .visible(false)
        .build();

    if let Ok(window) = window {
        let window_on_blur = window.clone();
        window.on_window_event(move |event| {
            if matches!(event, WindowEvent::Focused(false)) {
                let _ = window_on_blur.hide();
            }
        });
        position_tray_menu(app, &window, &tray_rect);
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn open_settings<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }

    let _ = WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("index.html?view=settings".into()))
        .title("Token Orb 设置")
        .inner_size(390.0, 570.0)
        .resizable(false)
        .decorations(true)
        .always_on_top(true)
        .build();
}

fn open_update_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("updater") {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("token-orb-check-update", ());
        return;
    }

    let window = WebviewWindowBuilder::new(app, "updater", WebviewUrl::App("index.html?view=updater".into()))
        .title("Token Orb 更新")
        .inner_size(420.0, 380.0)
        .resizable(false)
        .decorations(true)
        .always_on_top(true)
        .build();

    if let Ok(window) = window {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn position_monitor<R: Runtime>(app: &AppHandle<R>, window: &WebviewWindow<R>, tray_rect: Option<tauri::Rect>) {
    let window_size = window.outer_size().unwrap_or(PhysicalSize::new(410, 300));

    if let Some(rect) = tray_rect {
        let anchor = tray_anchor(&rect);
        let monitor = app
            .monitor_from_point(anchor.x as f64, anchor.y as f64)
            .ok()
            .flatten();
        let x = anchor.x - (window_size.width as i32 / 2);
        let y = anchor.y + 8;
        let position = monitor
            .as_ref()
            .map(|monitor| clamp_monitor_position(x, y, window_size, monitor.position(), monitor.size()))
            .unwrap_or_else(|| PhysicalPosition::new(x.max(8), y.max(8)));
        let _ = window.set_position(position);
        return;
    }

    if let Ok(Some(monitor)) = window.current_monitor() {
        let size = monitor.size();
        let position = monitor.position();
        let x = position.x + size.width as i32 - window_size.width as i32 - 8;
        let y = position.y + 32;
        let _ = window.set_position(PhysicalPosition::new(x, y));
    }
}

fn position_tray_menu<R: Runtime>(app: &AppHandle<R>, window: &WebviewWindow<R>, tray_rect: &tauri::Rect) {
    let window_size = window.outer_size().unwrap_or(PhysicalSize::new(250, 238));
    let anchor = tray_anchor(tray_rect);
    let x = anchor.x - (window_size.width as i32 / 2);
    let y = anchor.y + 6;
    let position = app
        .monitor_from_point(anchor.x as f64, anchor.y as f64)
        .ok()
        .flatten()
        .as_ref()
        .map(|monitor| clamp_monitor_position(x, y, window_size, monitor.position(), monitor.size()))
        .unwrap_or_else(|| PhysicalPosition::new(x.max(8), y.max(8)));
    let _ = window.set_position(position);
}

fn tray_anchor(rect: &tauri::Rect) -> PhysicalPosition<i32> {
    let position = rect.position.to_physical::<i32>(1.0);
    let size = rect.size.to_physical::<u32>(1.0);
    PhysicalPosition::new(position.x + (size.width as i32 / 2), position.y + size.height as i32)
}

fn clamp_monitor_position(
    x: i32,
    y: i32,
    window_size: PhysicalSize<u32>,
    monitor_position: &PhysicalPosition<i32>,
    monitor_size: &PhysicalSize<u32>,
) -> PhysicalPosition<i32> {
    const SCREEN_MARGIN: i32 = 8;
    let min_x = monitor_position.x + SCREEN_MARGIN;
    let max_x = monitor_position.x + monitor_size.width as i32 - window_size.width as i32 - SCREEN_MARGIN;
    let min_y = monitor_position.y + SCREEN_MARGIN;
    let max_y = monitor_position.y + monitor_size.height as i32 - window_size.height as i32 - SCREEN_MARGIN;
    PhysicalPosition::new(x.clamp(min_x, max_x.max(min_x)), y.clamp(min_y, max_y.max(min_y)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tray_anchor_uses_the_icon_center_and_bottom_edge() {
        let rect = tauri::Rect {
            position: tauri::Position::Physical(PhysicalPosition::new(1200, 0)),
            size: tauri::Size::Physical(PhysicalSize::new(24, 24)),
        };

        assert_eq!(tray_anchor(&rect), PhysicalPosition::new(1212, 24));
    }

    #[test]
    fn monitor_position_stays_within_the_clicked_monitor() {
        let position = clamp_monitor_position(
            1200,
            850,
            PhysicalSize::new(410, 300),
            &PhysicalPosition::new(0, 0),
            &PhysicalSize::new(1440, 900),
        );

        assert_eq!(position, PhysicalPosition::new(1022, 592));
    }

    #[test]
    fn tray_status_image_requires_matching_bounded_rgba_data() {
        let mut visible_image = vec![0; 200 * 36 * 4];
        visible_image[3] = 255;
        assert!(validate_tray_status_image(200, 36, &visible_image).is_ok());
        assert!(validate_tray_status_image(0, 36, &[]).is_err());
        assert!(validate_tray_status_image(1025, 36, &visible_image).is_err());
        assert!(validate_tray_status_image(200, 36, &[0]).is_err());
        assert!(validate_tray_status_image(1, 1, &[0, 0, 0, 0]).is_err());
    }
}
