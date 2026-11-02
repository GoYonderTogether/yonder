//! 安卓应用内更新（docs/spec/09 §6.3）：拉 `android/latest.json` 比较 versionCode，下载 APK 到应用缓存，
//! 校验 sha256 后交给 Android 系统安装器。**系统确认框由用户点击，不做静默安装**；装完由系统重启应用。
//!
//! 解析、比较、校验是纯函数，在宿主上跑 `cargo test`；只有 JNI 与网络下载在 Android 目标下编译。

use sha2::{Digest, Sha256};

/// 发布清单的固定地址，与 `scripts/release/android.mjs` 一致（OSS `android/latest.json`）。
pub const LATEST_URL: &str =
    "https://yonder-release.oss-cn-hangzhou.aliyuncs.com/android/latest.json";

/// 清单很小；限制上限，避免被错误响应撑爆内存。
#[cfg(target_os = "android")]
const MANIFEST_LIMIT: u64 = 64 * 1024;
/// APK 上限；超过就拒绝，不写入磁盘。
#[cfg(target_os = "android")]
const APK_LIMIT: u64 = 512 * 1024 * 1024;

/// 给网页监听的状态事件；载荷只有状态与版本或错误文本，不含凭据。
pub const UPDATE_EVENT: &str = "android-update";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Manifest {
    pub version: String,
    pub version_code: u64,
    pub url: String,
    pub sha256: String,
    pub size: Option<u64>,
}

/// 严格解析 latest.json：字段缺失或类型不对都算失败，不用默认值继续下载。
pub fn parse_manifest(json: &str) -> Result<Manifest, String> {
    let value: serde_json::Value = serde_json::from_str(json)
        .map_err(|error| format!("latest.json 不是合法 JSON：{error}"))?;
    let field = |name: &str| {
        value
            .get(name)
            .ok_or_else(|| format!("latest.json 缺少 {name}"))
    };
    let text = |name: &str| {
        field(name)?
            .as_str()
            .map(str::to_owned)
            .ok_or_else(|| format!("latest.json 的 {name} 不是字符串"))
    };
    let version = text("version")?;
    let version_code = field("versionCode")?
        .as_u64()
        .ok_or_else(|| "latest.json 的 versionCode 不是非负整数".to_owned())?;
    if version_code == 0 {
        return Err("latest.json 的 versionCode 为 0".to_owned());
    }
    let url = text("url")?;
    if !url.starts_with("https://") {
        return Err(format!("latest.json 的 url 不是 https：{url}"));
    }
    let sha256 = text("sha256")?.to_ascii_lowercase();
    if sha256.len() != 64 || !sha256.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("latest.json 的 sha256 不是 64 位十六进制".to_owned());
    }
    let size = match value.get("size") {
        None | Some(serde_json::Value::Null) => None,
        Some(size) => Some(
            size.as_u64()
                .ok_or_else(|| "latest.json 的 size 不是非负整数".to_owned())?,
        ),
    };
    Ok(Manifest {
        version,
        version_code,
        url,
        sha256,
        size,
    })
}

/// 只有清单的 versionCode 严格大于已安装版本才算有更新。
pub fn is_newer(manifest: &Manifest, installed: u64) -> bool {
    manifest.version_code > installed
}

/// 十六进制 sha256；下载校验与测试共用同一实现。
pub fn hex_sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub fn verify_digest(bytes: &[u8], expected_hex: &str) -> bool {
    hex_sha256(bytes).eq_ignore_ascii_case(expected_hex)
}

/// 缓存里放一个按版本命名的文件；文件名只保留安全字符，避免清单被篡改成路径。
pub fn apk_file_name(version: &str) -> String {
    let safe: String = version
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    format!("yonder-{safe}.apk")
}

#[cfg(target_os = "android")]
mod android {
    use super::*;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::Duration;
    use tauri::{Emitter, Manager};

    /// 同一时刻只跑一次检查；重复的启动/前台事件不会并发下载。
    static CHECKING: AtomicBool = AtomicBool::new(false);

    fn agent() -> ureq::Agent {
        ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(120)))
            .timeout_connect(Some(Duration::from_secs(15)))
            .build()
            .into()
    }

    /// 只接受 https 的清单地址；响应体按上限读取，不无限缓冲。
    fn fetch(url: &str, limit: u64) -> Result<Vec<u8>, String> {
        if !url.starts_with("https://") {
            return Err(format!("拒绝非 https 地址：{url}"));
        }
        let mut response = agent()
            .get(url)
            .header("Accept", "application/json, */*")
            .call()
            .map_err(|error| format!("GET {url} 失败：{error}"))?;
        response
            .body_mut()
            .with_config()
            .limit(limit)
            .read_to_vec()
            .map_err(|error| format!("读取 {url} 响应失败：{error}"))
    }

    fn cache_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
        let base = app
            .path()
            .app_cache_dir()
            .map_err(|error| format!("取应用缓存目录失败：{error}"))?;
        std::fs::create_dir_all(&base).map_err(|error| format!("创建缓存目录失败：{error}"))?;
        Ok(base)
    }

    fn write_verified(path: &Path, bytes: &[u8], manifest: &Manifest) -> Result<(), String> {
        if let Some(size) = manifest.size {
            if bytes.len() as u64 != size {
                return Err(format!("下载大小 {} 与清单 {} 不符", bytes.len(), size));
            }
        }
        if !verify_digest(bytes, &manifest.sha256) {
            return Err("APK 的 sha256 与清单不符，已拒绝安装".to_owned());
        }
        // 先写临时文件再改名：中断不会留下一个「已验证」的半截文件。
        let temporary = path.with_extension("apk.part");
        std::fs::write(&temporary, bytes).map_err(|error| format!("写入 APK 失败：{error}"))?;
        std::fs::rename(&temporary, path).map_err(|error| format!("落盘 APK 失败：{error}"))
    }

    fn emit(app: &tauri::AppHandle, state: &str, detail: Option<String>) {
        let payload = serde_json::json!({ "state": state, "detail": detail });
        let _ = app.emit(UPDATE_EVENT, payload);
    }

    /// 一次完整的检查 → 下载 → 校验 → 交给系统安装器。失败只上报，不重试、不静默忽略。
    pub fn check_and_install(app: &tauri::AppHandle) {
        if CHECKING.swap(true, Ordering::SeqCst) {
            return;
        }
        emit(app, "checking", None);
        let result = (|| -> Result<Option<String>, String> {
            let installed = crate::mobile_update::installed_version_code()?;
            let body = fetch(LATEST_URL, MANIFEST_LIMIT)?;
            let manifest = parse_manifest(&String::from_utf8_lossy(&body))?;
            if !is_newer(&manifest, installed) {
                return Ok(None);
            }
            emit(app, "downloading", Some(manifest.version.clone()));
            let bytes = fetch(&manifest.url, APK_LIMIT)?;
            let path = cache_dir(app)?.join(apk_file_name(&manifest.version));
            write_verified(&path, &bytes, &manifest)?;
            emit(app, "installing", Some(manifest.version.clone()));
            crate::mobile_update::start_system_installer(&path)?;
            Ok(Some(manifest.version))
        })();
        match result {
            Ok(None) => emit(app, "up-to-date", None),
            Ok(Some(version)) => emit(app, "installer-opened", Some(version)),
            Err(error) => emit(app, "error", Some(error)),
        }
        CHECKING.store(false, Ordering::SeqCst);
    }

    /// 检查放进阻塞线程池，不占 UI 线程。
    pub fn start(app: tauri::AppHandle) {
        let handle = app.clone();
        tauri::async_runtime::spawn_blocking(move || check_and_install(&handle));
    }
}

/// 已安装应用的 versionCode（`PackageInfo.longVersionCode`，API 28 以下退回 `versionCode`）。
#[cfg(target_os = "android")]
pub fn installed_version_code() -> Result<u64, String> {
    use jni::objects::{JObject, JValue};
    let context = ndk_context::android_context();
    let vm = unsafe { jni::JavaVM::from_raw(context.vm().cast()) }
        .map_err(|error| format!("取 JavaVM 失败：{error}"))?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|error| format!("连接 JVM 失败：{error}"))?;
    // tao 启动时把 Application Context 存为全局引用，这里只借用，不释放。
    let activity = unsafe { JObject::from_raw(context.context() as jni::sys::jobject) };
    let package = env
        .call_method(&activity, "getPackageName", "()Ljava/lang/String;", &[])
        .and_then(|value| value.l())
        .map_err(|error| format!("取包名失败：{error}"))?;
    let manager = env
        .call_method(
            &activity,
            "getPackageManager",
            "()Landroid/content/pm/PackageManager;",
            &[],
        )
        .and_then(|value| value.l())
        .map_err(|error| format!("取 PackageManager 失败：{error}"))?;
    let info = env
        .call_method(
            &manager,
            "getPackageInfo",
            "(Ljava/lang/String;I)Landroid/content/pm/PackageInfo;",
            &[JValue::Object(&package), JValue::Int(0)],
        )
        .and_then(|value| value.l())
        .map_err(|error| format!("取 PackageInfo 失败：{error}"))?;
    // `longVersionCode` 是 API 28 才有的字段。查不到时 JNI 会抛 NoSuchFieldError 并**留一个待抛异常**，
    // 不清理就继续调用，异常会在下一个 JNI 调用（或线程 detach）时把整个进程带走。所以失败一次就清一次。
    let code = match env.get_field(&info, "longVersionCode", "J") {
        Ok(value) => value.j(),
        Err(_) => {
            let _ = env.exception_clear();
            env.get_field(&info, "versionCode", "I").and_then(|value| value.i())
        }
    };
    code.map(|code| i64::from(code).max(0) as u64)
        .map_err(|error| {
            let _ = env.exception_clear();
            format!("读 versionCode 失败：{error}")
        })
}

/// 用 FileProvider 的 content URI 打开系统安装器。安装确认框由用户点，装完由系统重启应用。
#[cfg(target_os = "android")]
pub fn start_system_installer(apk: &std::path::Path) -> Result<(), String> {
    use jni::objects::{JObject, JString, JValue};
    const FLAG_GRANT_READ_URI_PERMISSION: i32 = 0x0000_0001;
    const FLAG_ACTIVITY_NEW_TASK: i32 = 0x1000_0000;

    let context = ndk_context::android_context();
    let vm = unsafe { jni::JavaVM::from_raw(context.vm().cast()) }
        .map_err(|error| format!("取 JavaVM 失败：{error}"))?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|error| format!("连接 JVM 失败：{error}"))?;
    let activity = unsafe { JObject::from_raw(context.context() as jni::sys::jobject) };

    let path = apk.to_string_lossy().into_owned();
    let path_string = env
        .new_string(&path)
        .map_err(|error| format!("构造路径字符串失败：{error}"))?;
    let file = env
        .new_object(
            "java/io/File",
            "(Ljava/lang/String;)V",
            &[JValue::Object(&path_string)],
        )
        .map_err(|error| format!("构造 File 失败：{error}"))?;

    let package = env
        .call_method(&activity, "getPackageName", "()Ljava/lang/String;", &[])
        .and_then(|value| value.l())
        .map_err(|error| format!("取包名失败：{error}"))?;
    let suffix = env
        .new_string(".fileprovider")
        .map_err(|error| format!("构造 authority 后缀失败：{error}"))?;
    let authority = env
        .call_method(
            &JString::from(package),
            "concat",
            "(Ljava/lang/String;)Ljava/lang/String;",
            &[JValue::Object(&suffix)],
        )
        .and_then(|value| value.l())
        .map_err(|error| format!("拼 FileProvider authority 失败：{error}"))?;

    let provider = env
        .find_class("androidx/core/content/FileProvider")
        .map_err(|error| format!("找不到 FileProvider：{error}"))?;
    let uri = env
        .call_static_method(
            &provider,
            "getUriForFile",
            "(Landroid/content/Context;Ljava/lang/String;Ljava/io/File;)Landroid/net/Uri;",
            &[
                JValue::Object(&activity),
                JValue::Object(&authority),
                JValue::Object(&file),
            ],
        )
        .and_then(|value| value.l())
        .map_err(|error| format!("生成 content URI 失败：{error}"))?;

    let mime = env
        .new_string("application/vnd.android.package-archive")
        .map_err(|error| format!("构造 MIME 失败：{error}"))?;
    let intent = env
        .new_object("android/content/Intent", "()V", &[])
        .map_err(|error| format!("构造 Intent 失败：{error}"))?;
    let action = env
        .get_static_field(
            "android/content/Intent",
            "ACTION_VIEW",
            "Ljava/lang/String;",
        )
        .and_then(|value| value.l())
        .map_err(|error| format!("取 ACTION_VIEW 失败：{error}"))?;
    env.call_method(
        &intent,
        "setAction",
        "(Ljava/lang/String;)Landroid/content/Intent;",
        &[JValue::Object(&action)],
    )
    .map_err(|error| format!("设置 action 失败：{error}"))?;
    env.call_method(
        &intent,
        "setDataAndType",
        "(Landroid/net/Uri;Ljava/lang/String;)Landroid/content/Intent;",
        &[JValue::Object(&uri), JValue::Object(&mime)],
    )
    .map_err(|error| format!("设置 data 与 MIME 失败：{error}"))?;
    env.call_method(
        &intent,
        "addFlags",
        "(I)Landroid/content/Intent;",
        &[JValue::Int(
            FLAG_GRANT_READ_URI_PERMISSION | FLAG_ACTIVITY_NEW_TASK,
        )],
    )
    .map_err(|error| format!("设置 flags 失败：{error}"))?;
    env.call_method(
        &activity,
        "startActivity",
        "(Landroid/content/Intent;)V",
        &[JValue::Object(&intent)],
    )
    .map_err(|error| format!("打开系统安装器失败：{error}"))?;
    Ok(())
}

/// 启动时检查一次；iOS 没有这条更新路径，明确不做。
pub fn start(app: &tauri::App) {
    #[cfg(target_os = "android")]
    android::start(app.handle().clone());
    #[cfg(not(target_os = "android"))]
    let _ = app;
}

/// 回到前台时再检查一次。
pub fn watch_resume(app: &tauri::App) {
    #[cfg(target_os = "android")]
    if let Some(window) = tauri::Manager::get_webview_window(app, "main") {
        let handle = app.handle().clone();
        window.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::Resumed) {
                android::start(handle.clone());
            }
        });
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MANIFEST: &str = r#"{"version":"0.3.26110205","versionCode":26110205,"url":"https://yonder-release.oss-cn-hangzhou.aliyuncs.com/android/yonder-0.3.26110205.apk","sha256":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","size":10}"#;

    #[test]
    fn parses_complete_manifest() {
        let manifest = parse_manifest(MANIFEST).unwrap();
        assert_eq!(manifest.version, "0.3.26110205");
        assert_eq!(manifest.version_code, 26110205);
        assert_eq!(manifest.size, Some(10));
        // size 可以缺省：留空时只靠 sha256 校验
        let without_size = MANIFEST.replace(",\"size\":10", "");
        assert_eq!(parse_manifest(&without_size).unwrap().size, None);
    }

    #[test]
    fn rejects_incomplete_or_insecure_manifest() {
        assert!(parse_manifest("{}").is_err());
        assert!(parse_manifest("not json").is_err());
        assert!(parse_manifest(r#"{"version":"1","versionCode":1}"#).is_err());
        assert!(parse_manifest(&MANIFEST.replace("https://", "http://")).is_err());
        assert!(parse_manifest(&MANIFEST.replace(
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            "abc"
        ))
        .is_err());
        assert!(parse_manifest(&MANIFEST.replace("26110205", "0")).is_err());
    }

    #[test]
    fn compares_version_codes_strictly() {
        let manifest = parse_manifest(MANIFEST).unwrap();
        assert!(is_newer(&manifest, 26110204));
        assert!(!is_newer(&manifest, 26110205));
        assert!(!is_newer(&manifest, 26110206));
    }

    #[test]
    fn verifies_sha256() {
        let digest = hex_sha256(b"apk");
        assert_eq!(digest.len(), 64);
        assert!(verify_digest(b"apk", &digest));
        assert!(verify_digest(b"apk", &digest.to_uppercase()));
        assert!(!verify_digest(b"apk2", &digest));
        assert!(!verify_digest(
            b"apk",
            "c0c4f0b3e0c1f4b1b8a9d5c0aa2b8f7c15c8b6b3f1e0d9c8b7a6f5e4d3c2b1a0"
        ));
    }

    #[test]
    fn sanitizes_apk_file_names() {
        assert_eq!(apk_file_name("0.3.26110205"), "yonder-0.3.26110205.apk");
        assert_eq!(apk_file_name("../evil"), "yonder-.._evil.apk");
    }
}
