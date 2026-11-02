//! 本机核心探测：先问已安装的 `yonder ui --json` 要地址，再用短超时确认本机网关真的可达。
//!
//! 路径解析、输出解析与导航白名单都是纯函数，测试不需要 Tauri 运行时。探测只发一次
//! `GET` 并只读状态行；令牌只用来加载窗口，不写日志、不落盘（见 docs/spec/09 §6.2）。

use std::io::{Read, Write};
use std::net::{Ipv6Addr, SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// 运行 `yonder ui --json` 的最长等待时间。它要经控制接口向运行中的服务要票据，
/// 在本机实测是 3–8 秒（CLI 冷启动 + 控制面往返）；给到 10 秒，避免服务正常却回落云端。
const CLI_TIMEOUT: Duration = Duration::from_secs(10);
/// 本机网关可达性探测的超时。
const PROBE_TIMEOUT: Duration = Duration::from_millis(1500);

/// 本机网关地址：只接受回环 http，避免被任意 URL 带出去。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Endpoint {
    pub host: String,
    pub port: u16,
    pub path: String,
}

impl Endpoint {
    fn authority(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }

    /// 探测用的路径：去掉查询串。`yonder ui --json` 给的 `?token=` 是一次性票据，
    /// 在这里 GET 一次就会把它消耗掉，窗口随后只会被重定向到登录页。
    /// 不带票据的请求同样能证明端口后面是 HTTP 服务（网关会 302 到 /login）。
    fn probe_path(&self) -> &str {
        match self.path.find('?') {
            Some(index) => &self.path[..index],
            None => &self.path,
        }
    }

    fn socket_addr(&self) -> Option<SocketAddr> {
        match self.host.as_str() {
            "127.0.0.1" | "localhost" => Some(SocketAddr::from(([127, 0, 0, 1], self.port))),
            "[::1]" => Some(SocketAddr::from((Ipv6Addr::LOCALHOST, self.port))),
            _ => None,
        }
    }
}

/// 安装目录候选：`YONDER_INSTALL` → 平台默认 → 旧布局 `~/.yonder-harness`（见 spec/09 §3）。
///
/// `local_app_data` 只在 Windows 传入；Unix 传 `None`。第一个带 wrapper 的候选胜出。
pub fn install_candidates(
    env_install: Option<&Path>,
    home: &Path,
    local_app_data: Option<&Path>,
) -> Vec<PathBuf> {
    let mut candidates = Vec::with_capacity(2);
    match env_install {
        Some(dir) => candidates.push(dir.to_path_buf()),
        None => match local_app_data {
            Some(dir) => candidates.push(dir.join("YonderHarness").join("install")),
            None => candidates.push(
                home.join(".local")
                    .join("share")
                    .join("yonder")
                    .join("install"),
            ),
        },
    }
    candidates.push(home.join(".yonder-harness"));
    candidates
}

/// 安装根下的 CLI 入口；Windows 是 `bin/yonder.cmd`。
pub fn wrapper(install: &Path, windows: bool) -> PathBuf {
    install
        .join("bin")
        .join(if windows { "yonder.cmd" } else { "yonder" })
}

/// 第一个真的装了 wrapper 的安装目录。
pub fn find_install(candidates: &[PathBuf], windows: bool) -> Option<PathBuf> {
    candidates
        .iter()
        .find(|dir| wrapper(dir, windows).is_file())
        .cloned()
}

/// `yonder ui --json` 的单行输出 → URL。只接受回环地址；报错 JSON 或缺字段都算不可用。
pub fn parse_ui_output(stdout: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(stdout.trim()).ok()?;
    let url = value.get("url")?.as_str()?;
    local_endpoint(url)?;
    Some(url.to_string())
}

/// 解析本机回环地址：`http://127.0.0.1:<port>/…`、`http://localhost:<port>/…`、`http://[::1]:<port>/…`。
pub fn local_endpoint(url: &str) -> Option<Endpoint> {
    let rest = url.strip_prefix("http://")?;
    let (authority, path) = match rest.find('/') {
        Some(index) => (&rest[..index], &rest[index..]),
        None => (rest, "/"),
    };
    let (host, port) = authority.rsplit_once(':')?;
    if !matches!(host, "127.0.0.1" | "localhost" | "[::1]") {
        return None;
    }
    let port: u16 = port.parse().ok()?;
    if port == 0 {
        return None;
    }
    Some(Endpoint {
        host: host.to_string(),
        port,
        path: path.to_string(),
    })
}

/// 窗口内导航白名单：云端站点与本机网关都算同一应用，其他协议或域名交系统浏览器。
pub fn navigation_allowed(
    scheme: &str,
    host: Option<&str>,
    port: Option<u16>,
    local: Option<&Endpoint>,
    cloud_host: Option<&str>,
) -> bool {
    if scheme == "https" && cloud_host.is_some() && host == cloud_host {
        return true;
    }
    match (local, host) {
        (Some(local), Some(host)) => {
            scheme == "http" && host == local.host && port == Some(local.port)
        }
        _ => false,
    }
}

/// 任意 HTTP 响应行都说明端口后面有服务在听（302 去登录页、401 都算可达）。
pub fn is_http_response(head: &[u8]) -> bool {
    head.starts_with(b"HTTP/")
}

/// 短超时探测本机网关。
pub fn probe(endpoint: &Endpoint) -> bool {
    let Some(address) = endpoint.socket_addr() else {
        return false;
    };
    let Ok(mut stream) = TcpStream::connect_timeout(&address, PROBE_TIMEOUT) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(PROBE_TIMEOUT));
    let _ = stream.set_write_timeout(Some(PROBE_TIMEOUT));
    let request = format!(
        "GET {} HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n\r\n",
        endpoint.probe_path(),
        endpoint.authority()
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut head = [0u8; 64];
    match stream.read(&mut head) {
        Ok(read) if read > 0 => is_http_response(&head[..read]),
        _ => false,
    }
}

fn home_dir() -> Option<PathBuf> {
    let variable = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var_os(variable).map(PathBuf::from)
}

fn local_app_data() -> Option<PathBuf> {
    if cfg!(windows) {
        std::env::var_os("LOCALAPPDATA").map(PathBuf::from)
    } else {
        None
    }
}

/// 跑一次 `yonder ui --json`；失败、超时或输出不合法都返回 `None`。stderr 丢弃，避免日志带出令牌。
fn run_ui(cli: &Path) -> Option<String> {
    let mut command = if cfg!(windows) {
        // .cmd 不能直接 CreateProcess，经 cmd.exe 运行；路径由安装目录决定，不拼 shell 字符串。
        let mut command = Command::new("cmd");
        command.args(["/C"]).arg(cli);
        command
    } else {
        Command::new(cli)
    };
    command
        .args(["ui", "--json"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = command.spawn().ok()?;
    let deadline = Instant::now() + CLI_TIMEOUT;
    loop {
        match child.try_wait().ok()? {
            Some(status) => {
                if !status.success() {
                    return None;
                }
                let mut stdout = String::new();
                child.stdout.take()?.read_to_string(&mut stdout).ok()?;
                return parse_ui_output(&stdout);
            }
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            None => std::thread::sleep(Duration::from_millis(25)),
        }
    }
}

/// 启动时决定窗口加载哪个地址：本机网关可达就用它，否则回落云端站点。
pub fn detect_local_url() -> Option<String> {
    let home = home_dir()?;
    let env_install = std::env::var_os("YONDER_INSTALL").map(PathBuf::from);
    let candidates = install_candidates(env_install.as_deref(), &home, local_app_data().as_deref());
    let install = find_install(&candidates, cfg!(windows))?;
    let url = run_ui(&wrapper(&install, cfg!(windows)))?;
    let endpoint = local_endpoint(&url)?;
    probe(&endpoint).then_some(url)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::net::TcpListener;

    fn temp(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("yonder-desktop-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn install_candidates_prefer_the_override_and_keep_the_legacy_root() {
        let home = Path::new("/home/alice");
        let override_dir = Path::new("/opt/yonder");
        assert_eq!(
            install_candidates(Some(override_dir), home, None),
            vec![override_dir.to_path_buf(), home.join(".yonder-harness")]
        );
        assert_eq!(
            install_candidates(None, home, None),
            vec![
                home.join(".local/share/yonder/install"),
                home.join(".yonder-harness")
            ]
        );
        assert_eq!(
            install_candidates(
                None,
                home,
                Some(Path::new("C:\\Users\\alice\\AppData\\Local"))
            ),
            vec![
                PathBuf::from("C:\\Users\\alice\\AppData\\Local")
                    .join("YonderHarness")
                    .join("install"),
                home.join(".yonder-harness")
            ]
        );
    }

    #[test]
    fn find_install_skips_roots_without_a_wrapper() {
        let dir = temp("find-install");
        let legacy = dir.join(".yonder-harness");
        fs::create_dir_all(legacy.join("bin")).unwrap();
        fs::write(legacy.join("bin/yonder"), "#!/bin/sh\n").unwrap();
        let candidates = vec![dir.join(".local/share/yonder/install"), legacy.clone()];
        assert_eq!(find_install(&candidates, false), Some(legacy));
        assert_eq!(find_install(&candidates, true), None);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn parse_ui_output_accepts_only_a_loopback_url() {
        assert_eq!(
            parse_ui_output(
                r#"{"url":"http://127.0.0.1:4123/?token=abc","expiresAt":"2026-11-02T00:00:00Z"}"#
            ),
            Some("http://127.0.0.1:4123/?token=abc".to_string())
        );
        assert_eq!(parse_ui_output(r#"{"error":"home not found"}"#), None);
        assert_eq!(parse_ui_output("not json"), None);
        assert_eq!(parse_ui_output(r#"{"url":"https://yonderbot.net/"}"#), None);
        assert_eq!(parse_ui_output(r#"{"url":"http://10.0.0.5:4123/"}"#), None);
    }

    #[test]
    fn local_endpoint_reads_host_port_and_path() {
        assert_eq!(
            local_endpoint("http://127.0.0.1:8080/?token=x"),
            Some(Endpoint {
                host: "127.0.0.1".to_string(),
                port: 8080,
                path: "/?token=x".to_string()
            })
        );
        assert_eq!(
            local_endpoint("http://localhost:9"),
            Some(Endpoint {
                host: "localhost".to_string(),
                port: 9,
                path: "/".to_string()
            })
        );
        assert!(local_endpoint("http://[::1]:8080/").is_some());
        assert_eq!(local_endpoint("https://127.0.0.1:8080/"), None);
        assert_eq!(local_endpoint("http://127.0.0.1/"), None);
        assert_eq!(local_endpoint("http://127.0.0.1:0/"), None);
        assert_eq!(local_endpoint("http://example.com:8080/"), None);
    }

    #[test]
    fn navigation_keeps_cloud_and_local_only() {
        let local = local_endpoint("http://127.0.0.1:8080/").unwrap();
        assert!(navigation_allowed(
            "https",
            Some("yonderbot.net"),
            Some(443),
            None,
            Some("yonderbot.net")
        ));
        assert!(navigation_allowed(
            "http",
            Some("127.0.0.1"),
            Some(8080),
            Some(&local),
            Some("yonderbot.net")
        ));
        assert!(navigation_allowed(
            "http",
            Some("127.0.0.1"),
            Some(8080),
            Some(&local),
            None
        ));
        assert!(!navigation_allowed(
            "http",
            Some("127.0.0.1"),
            Some(8081),
            Some(&local),
            Some("yonderbot.net")
        ));
        assert!(!navigation_allowed(
            "https",
            Some("127.0.0.1"),
            Some(8080),
            Some(&local),
            Some("yonderbot.net")
        ));
        assert!(!navigation_allowed(
            "https",
            Some("example.com"),
            Some(443),
            Some(&local),
            Some("yonderbot.net")
        ));
        assert!(!navigation_allowed(
            "http",
            Some("127.0.0.1"),
            Some(8080),
            None,
            Some("yonderbot.net")
        ));
    }

    #[test]
    fn probe_accepts_any_http_status_line() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0u8; 512];
            let read = stream.read(&mut request).unwrap();
            let line = String::from_utf8_lossy(&request[..read]).to_string();
            let _ = stream.write_all(b"HTTP/1.1 302 Found\r\nLocation: /login\r\n\r\n");
            line
        });
        let endpoint = local_endpoint(&format!("http://127.0.0.1:{port}/?token=one")).unwrap();
        assert!(probe(&endpoint));
        // 探测不能带上一次性票据，否则窗口打开时票据已被消耗。
        let request = server.join().unwrap();
        assert!(request.starts_with("GET / HTTP/1.1\r\n"), "{request}");
        assert!(!request.contains("token=one"), "{request}");
    }

    #[test]
    fn probe_rejects_a_closed_port_and_non_http_replies() {
        assert!(!is_http_response(b"SSH-2.0-OpenSSH"));
        assert!(is_http_response(b"HTTP/1.1 200 OK"));
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let endpoint = local_endpoint(&format!("http://127.0.0.1:{port}/")).unwrap();
        assert!(!probe(&endpoint));
    }
}
