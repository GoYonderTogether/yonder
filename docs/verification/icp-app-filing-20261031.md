# yonderbot.net 网站备案与 Yonder App 备案：已填写数据与待办

2026-10-31。阿里云备案订单 `2038869799229`（有主体新增互联网信息服务，主体：未至之境（武汉）科技有限公司，鄂ICP备2026027205号；负责人 曾子悦）。

## 当前状态

- **未提交**。两端的「完成填写」都需要负责人手机 `159****3244` 的短信验证码；按主人要求本轮只准备数据，不代收验证码。只有点「完成填写」后条目才会进入订单的「已填写的互联网信息服务列表」，仅「保存草稿」不入列。
- 已实测：`https://yonderbot.net/` 返回 200 并在浏览器打开应用登录页；`https://yonder.zethai.cn/*` 301 跳到 `https://yonderbot.net/*`（含深链 `/c/GM7O0C`）。
- 证书：ohttps Let's Encrypt 多域名（`yonderbot.net`、`www.yonderbot.net`），2026-10-31 签发，2027-01-28 到期，89 天；私钥与证书在 `~/.yonder-signing/tls/yonderbot.net/`，服务器 `/etc/nginx/ssl/yonderbot.net/`。

## 网站备案（yonderbot.net）

| 字段 | 值 |
|---|---|
| 网站名称 | Yonder 智能助手 |
| 域名 | yonderbot.net |
| 网站内容 | 其他 |
| 网站语言 | 中文简体 |
| 云服务 / 实例 | ECS / i-bp128kp805ifz20hmm03（47.98.126.143），该实例免费备案额度 1/5 已用 |
| 前置审批 | 无 |
| 负责人 | 曾子悦，居民身份证 420111200406105515，15972003244，xcyyds@foxmail.com |

网站备注：

> Yonder 是部署在本机或自有服务器上的个人 AI Agent 客户端：网页端提供账号登录、设备绑定、会话与任务管理，App 端（Android/iOS）为同一套网页的移动壳，连接同一后台服务 yonderbot.net。不含新闻、出版、教育、医疗、金融等需前置审批的内容。

## App 备案（Yonder）

| 字段 | 值 |
|---|---|
| App 名称 | Yonder |
| App 图标 | `brand/assets/png/yonder-tile-ink-1024.png`（1024×1024） |
| 内容分类 | 信息传输、软件和信息技术服务业 / 软件开发 |
| App 语言 | 中文简体 |
| 是否对外提供 SDK | 不提供 |
| App 全部后台服务域名 | yonderbot.net |
| 接入阿里云服务器的域名 | yonderbot.net（需该项先填，运行平台的「具体使用的域名」才有可选值） |
| 云服务 / 实例 | ECS / i-bp128kp805ifz20hmm03（47.98.126.143） |
| 负责人 | 同网站备案 |

App 备注：

> Yonder 是个人 AI Agent 客户端：用户在本机或自有服务器运行 Agent，通过本 App 登录账号并连接自有后台服务 yonderbot.net，查看会话、任务与设备状态。不提供内容分发、直播、金融、医疗等需前置审批的服务。

### Android 平台

| 字段 | 值 |
|---|---|
| 包名 | `net.yonderbot.app` |
| 公钥（Base64 SPKI） | 见文末 |
| 证书 MD5 | `db539fbde17d6d33a6a997a6cfbaca9b` |
| 证书 SHA-1 | `B9:D8:B7:36:3C:2B:07:E2:D4:19:55:91:6F:86:58:AF:BA:14:83:E0` |

签名材料在 `~/.yonder-signing/android/`（`yonder-release.jks`、`keystore.password`、`README.md`）。keystore 丢失后已发布版本无法更新，必须备份。

### iOS 平台

| 字段 | 值 |
|---|---|
| Bundle ID | `net.yonderbot.app` |
| Team ID | `D4UZU32UN9` |
| 证书 | Apple Distribution: zoran zeng，2027-10-31 到期 |
| 证书 SHA-1 | `55:97:B1:40:F1:E6:6D:78:3E:2D:B7:D7:A2:78:70:45:AB:BB:61:A4` |
| 公钥（Base64 SPKI） | 见文末 |

密钥与证书在 `~/.yonder-signing/ios/`（`yonderbot-ios.key`、`distribution.cer`、`distribution.pem`）。

## 已完成的 App 壳初始化

- `apps/desktop/src-tauri/src/lib.rs`：桌面/移动共用入口；移动端 `tauri::mobile_entry_point` 打开 `https://yonderbot.net`，不加载本机运行时。
- `tauri.android.conf.json` / `tauri.ios.conf.json`：`identifier = net.yonderbot.app`，移除桌面 runtime 资源；`tauri.android.conf.json` 固定 `versionCode = 26103020`。
- `capabilities/desktop.json`、`capabilities/mobile.json`：按平台拆分，移动端只放行 `https://yonderbot.net/*`。
- `apps/desktop/prepare-android.mjs`：重生成 `gen/android` 后重新接上正式签名、阿里云 Maven 镜像、关闭 AGP 的 SDK 自动下载（`dl.google.com` 在本机不可达）。
- `apps/desktop/src-tauri/tauri`：`node tauri android android-studio-script` 需要的 CLI 垫片。

### 构建证据

- Android：`tauri android build --apk --target aarch64` 成功，产物 `gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`（13.8 MB）。`aapt2 dump badging` 显示 `package name='net.yonderbot.app' versionCode='26103020'`；`apksigner verify --print-certs` 报告的证书 MD5 与备案值一致。
- iOS：App ID `net.yonderbot.app` 已在 Apple 开发者后台注册，Apple Distribution 证书已签发并下载。**未完成**：`tauri ios build --target aarch64-sim` 首次因缺少 iOS 27.2 模拟器 SDK 失败；随后 `xcodebuild -downloadPlatform iOS` 已安装，但本轮未重跑构建。

## 未测 / 待办

- 两端 App 尚未在真机或模拟器上启动验证。
- Android 只构建了 universal（含 arm64 等全部 ABI）的 release APK；AAB 未构建。
- 备案表单未提交；「接入阿里云服务器的域名」与运行平台「具体使用的域名」都还不能自动带出，因为 yonderbot.net 的网站备案尚未进入管局流程。
- 老域名的 A 记录与 zethai.cn 证书仍在，跳转依赖它；zethai.cn 证书 2027-01-27 到期，需在此之前保持续签或直接停用旧域名。
- ohttps 每 90 天要续签；当前未配置自动部署，续签后需手工替换 `/etc/nginx/ssl/yonderbot.net/`。

## 公钥

Android（Base64 SPKI DER）：

```
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEArWJ05j/Nv7HT771ZhXRZQwjxVSVYyS+icFb3zcLzSorfHKFHRmHpGbokw4P59kBPjCs4OopHMeDHl4jzWmMn4dRlSHVcUHwOaM9eDVM4NvcTwPnILztLnzXixnVwhH3ksqjYJVQNLHUCtBhPD12BbLKHDDg8hdDWZAa/dwfQX5z3/7iC3U+lr4pz9B8eni1ev+sr++uG7QK4HQI0KeptIB9KHVV35nhi9ivHESocJgjDTfOiawosp9XcS4dLQFgDAOd8fYzSVacQBXlmocIc9XXh31Tr/JJw0Nm+X0O3bsHhB1ORiOJzTvWpnj+F0irCtlu5dCNdCPAsfrALRK0KBoX5tCjVJ5f9R+RY9QORZuVAYSHuSaUkk7hQQmg4yC7yeUApyYBbFHFHHli5r4cnwdoeLmVjL0MZ9fhZUTTJB2/g3TzyRUysh4dZlfC51/iYoKOxuYSxjYCfkOQI/w/klpdPNGFME3GsciB2MBcMJK7FdwDmwHIpgtD8MrGXQ/EWykorxXa68jPO9Pjd7+QUXhGVn6p6qtvqUZ5iTRjr564wJgrc/3jq4b8IGpsOjUeWnUD3bLKk3kaSLDYkYJqua2Wr5EisKk1QMhYXgO+3cTGfwr06+TEdeLptIHedkoJbXYuYcCQ8nGrZZy08fMMbCyyVAD0ZENqSziTy/FRr0VUCAwEAAQ==
```

iOS（Base64 SPKI DER）：

```
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA4Gv7ymhXbENKM7uZitXgl7NICDR1GazNqxgvRUf+TdgVYCaLs1Ao6P5rCi39W9+UoTDTQLup1ohOrQg0CLhQx8BHHCyhnMoqtnQ2SKynPv3AKxqUzBXHtA+MKQy3EVyU+DGQH0KJB5vx85pJ3Krrppq6WS5NJZBrJD+sqAbTWkzOFti6chNEU4mvDPOOy8ZNngkECJYckFXJQxM+xGQWCpKQj0dBYXaEtaUlfBMTIxzOasUMnVvR4NuPK2hJhRPu9VNfqv57IR69WbF/6k+wJPSAtFSozlQxVpmCjlgip7XQ5eUg1dTITHPS2N1ac+AQ9ZxGk80N8uX2Hj6gPnf+UwIDAQAB
```
