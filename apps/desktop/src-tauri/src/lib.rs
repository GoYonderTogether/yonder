use tauri::{WebviewUrl, WebviewWindowBuilder};

/// 桌面客户端加载与线上完全相同的站点：同一份前端产物、同一路由、同一数据来源。
/// 不注入 `__YONDER_SHELL__`、不打包本机运行时、不探测本地网关（见 docs/spec/09 §6.2）。
#[cfg(desktop)]
const CLOUD_ORIGIN: &str = "https://yonderbot.net";

/// 手机壳打开的云端地址；与 channel-card、market 的默认 endpoint 保持一致。
#[cfg(mobile)]
const MOBILE_ORIGIN: &str = "https://yonderbot.net";

/// 外站链接交系统浏览器；壳本身不做第二套容器。
fn open_external(url: &str) {
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(url).spawn();
    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("cmd").args(["/C", "start", "", url]).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let _ = std::process::Command::new("xdg-open").arg(url).spawn();
}

pub fn run() {
    #[cfg(desktop)]
    let builder = tauri::Builder::default().setup(|app| {
        setup_desktop(app)?;
        Ok(())
    });

    #[cfg(mobile)]
    let builder = tauri::Builder::default().setup(|app| {
        setup_mobile(app)?;
        Ok(())
    });

    builder
        .run(tauri::generate_context!())
        .expect("failed to run Yonder");
}

/// 站点内的导航留在窗口里；其它协议或域名交给系统浏览器，不在壳内打开第二套页面。
#[cfg(desktop)]
fn setup_desktop(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let cloud: tauri::Url = CLOUD_ORIGIN.parse()?;
    let host = cloud.host_str().map(str::to_owned);
    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(cloud))
        .title("Yonder")
        .inner_size(1280.0, 800.0)
        .min_inner_size(720.0, 480.0)
        .on_navigation(move |url| {
            let same_site = url.scheme() == "https" && url.host_str() == host.as_deref();
            if !same_site {
                open_external(url.as_str());
            }
            same_site
        })
        .on_new_window(move |url, _| {
            open_external(url.as_str());
            tauri::webview::NewWindowResponse::Deny
        })
        .build()?;
    Ok(())
}

#[cfg(mobile)]
fn setup_mobile(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let url: tauri::Url = MOBILE_ORIGIN.parse()?;
    let window = WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::External(url))
        .title("Yonder")
        .build()?;
    let _ = window;
    Ok(())
}

/// Android/iOS 的入口符号；桌面不生成（桌面走 src/main.rs → run()）。
#[cfg(mobile)]
#[tauri::mobile_entry_point]
fn mobile_main() {
    run()
}
