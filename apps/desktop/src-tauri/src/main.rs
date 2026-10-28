use std::io::{Read, Write};
use std::process::Command;
use std::time::Duration;

fn console_available(port: u16) -> bool {
    let Ok(mut socket) = std::net::TcpStream::connect_timeout(
        &([127, 0, 0, 1], port).into(),
        Duration::from_secs(1),
    ) else {
        return false;
    };
    let _ = socket.set_read_timeout(Some(Duration::from_secs(1)));
    if write!(socket, "GET /console/api/rpc/capabilities.get HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n").is_err() { return false; }
    let mut bytes = [0; 64];
    socket
        .read(&mut bytes)
        .is_ok_and(|n| bytes[..n].starts_with(b"HTTP/1.1 401"))
}
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_notification::NotificationExt;

#[tauri::command]
fn set_activity(app: tauri::AppHandle, running: u32, waiting: u32) {
    if let Some(tray) = app.tray_by_id("activity") {
        let status = format!("运行中 {running} · 等待 {waiting}");
        let _ = tray.set_title(Some(&status));
        let _ = tray.set_tooltip(Some(&status));
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![set_activity])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let handle = app.handle().clone();
            app.notification().on_action(move |action| {
                let Some(session) = action.notification().and_then(|notification| notification.extra().get("session")).and_then(|value| value.as_str()) else { return; };
                if let Some(window) = handle.get_webview_window("main") {
                    if let Ok(session) = serde_json::to_string(session) {
                        let _ = window.eval(format!("location.hash = '#/s/' + encodeURIComponent({session})"));
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            })?;
            let open = tauri::menu::MenuItem::with_id(app, "open", "打开", true, None::<&str>)?;
            let quit = tauri::menu::MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = tauri::menu::Menu::with_items(app, &[&open, &quit])?;
            let icon = tauri::image::Image::new_owned(vec![0, 100, 220, 255].repeat(16 * 16), 16, 16);
            tauri::tray::TrayIconBuilder::with_id("activity")
                .icon(icon).menu(&menu).title("Yonder")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => { if let Some(window) = app.get_webview_window("main") { let _ = window.show(); let _ = window.set_focus(); } },
                    "quit" => app.exit(0),
                    _ => (),
                }).build(app)?;
            let resource_dir = app.path().resource_dir()?;
            let hash = std::fs::read_to_string(resource_dir.join("runtime.sha256"))?;
            if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Err("invalid runtime hash".into());
            }
            let runtime = app.path().app_local_data_dir()?.join(format!("runtime-{hash}"));
            if !runtime.join(".complete").exists() {
                std::fs::create_dir_all(&runtime)?;
                let archive = std::fs::File::open(resource_dir.join("runtime.tar"))?;
                tar::Archive::new(archive).unpack(&runtime)?;
                std::fs::write(runtime.join(".complete"), b"")?;
            }
            let output = Command::new(runtime.join("node"))
                .arg(runtime.join("packages/cli/dist/index.js"))
                .args(["ui", "--json"]).output();
            let url = output.ok().filter(|o| o.status.success()).and_then(|o| {
                let json: serde_json::Value = serde_json::from_slice(&o.stdout).ok()?;
                let url = json["url"].as_str()?;
                let mut parsed: tauri::Url = url.parse().ok()?;
                if parsed.host_str()? != "127.0.0.1" || parsed.scheme() != "http" { return None; }
                if !console_available(parsed.port()?) { return None; }
                parsed.set_path("/console/");
                Some(parsed)
            });
            let url = url.map(WebviewUrl::External).unwrap_or(WebviewUrl::App("index.html".into()));
            let platform = std::env::consts::OS;
            WebviewWindowBuilder::new(app, "main", url)
                .title("Yonder")
                .initialization_script(format!("window.__YONDER_SHELL__ = {{ kind: 'desktop', platform: '{platform}' }}; if (location.pathname === '/console/' && !location.search.includes('token=') && !location.search.includes('shell=desktop')) {{ const u = new URL(location.href); u.searchParams.set('shell', 'desktop'); location.replace(u.href); }}"))
                .initialization_script(include_str!("activity.js"))
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run Yonder desktop");
}
