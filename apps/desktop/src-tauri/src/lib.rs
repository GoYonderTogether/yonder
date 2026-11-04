use tauri::{WebviewUrl, WebviewWindowBuilder};

#[cfg(desktop)]
mod local;

// 安卓应用内更新（docs/spec/09 §6.3）。只在 Android 与宿主的 cargo test 下编译：
// 纯解析/比较/校验有测试，JNI 与下载只在 Android 目标里。
#[cfg(any(target_os = "android", test))]
#[cfg_attr(test, allow(dead_code))]
mod mobile_update;

/// iOS 没有应用内更新路径，但 setup 里统一调用这两个入口；用空实现占位，
/// 免得 `setup_mobile` 在 iOS 目标上引用不到模块（实测 iOS 构建因此失败）。
#[cfg(all(mobile, not(target_os = "android")))]
mod mobile_update {
    pub fn start(_app: &tauri::App) {}
    pub fn watch_resume(_app: &tauri::App) {}
}

/// 本机核心不可用时的云端站点；与线上完全相同的产物、路由与数据来源。
/// 不注入 `__YONDER_SHELL__`、不打包本机运行时（见 docs/spec/09 §6.2）。
#[cfg(desktop)]
const CLOUD_ORIGIN: &str = "https://yonder.zethai.cn";

/// 手机壳打开的云端地址；与 channel-card、market 的默认 endpoint 保持一致。
/// 调试构建可用 `YONDER_MOBILE_ORIGIN` 指向本机开发服务器（真机 / 模拟器验收壳内网页用）；
/// 正式构建不设这个变量，始终是线上站点。
#[cfg(mobile)]
const MOBILE_ORIGIN: &str = match option_env!("YONDER_MOBILE_ORIGIN") {
    Some(origin) => origin,
    None => "https://yonder.zethai.cn",
};

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

/// 站点内的导航留在窗口里：本机网关与云端站点算同一个应用；其它协议或域名交给系统浏览器。
#[cfg(desktop)]
fn setup_desktop(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let cloud: tauri::Url = CLOUD_ORIGIN.parse()?;
    let cloud_host = cloud.host_str().map(str::to_owned);
    // 先探测本机核心；未安装、已停止或命令失败都回落到云端站点。令牌只用于加载，不落日志。
    let target: tauri::Url = match local::detect_local_url() {
        Some(url) => url.parse()?,
        None => cloud,
    };
    let local = local::local_endpoint(target.as_str());
    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(target))
        .title("Yonder")
        .inner_size(1280.0, 800.0)
        .min_inner_size(720.0, 480.0)
        .on_navigation(move |url| {
            let same_site = local::navigation_allowed(
                url.scheme(),
                url.host_str(),
                url.port_or_known_default(),
                local.as_ref(),
                cloud_host.as_deref(),
            );
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
    // iOS 原生设备能力（日历/提醒/通讯录/照片/位置/健康）；命令面只对远程站点放开
    // （capabilities/mobile.json）。Android 没有对应实现，插件本身不参与 Android 构建。
    #[cfg(target_os = "ios")]
    app.handle().plugin(tauri_plugin_yonder_device::init())?;
    // 安卓应用内更新（docs/spec/09 §6.3）：启动时检查一次，回到前台再检查。
    // 系统安装确认框由用户点击；装完由系统重启应用。
    mobile_update::start(app);
    mobile_update::watch_resume(app);
    Ok(())
}

/// Android/iOS 的入口符号；桌面不生成（桌面走 src/main.rs → run()）。
#[cfg(mobile)]
#[tauri::mobile_entry_point]
fn mobile_main() {
    run()
}
