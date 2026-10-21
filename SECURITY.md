# Security policy · 安全策略

**English** · [简体中文](#简体中文)

## Supported versions

Yonder Harness is a developer preview. Only the latest release receives security fixes.

## Reporting a vulnerability

Please report vulnerabilities **privately** through this repository's *Security → Report a vulnerability* page. Do not open a public issue or pull request for a suspected vulnerability.

Include the output of `yonder version`, your platform, the plugins involved, a minimal reproduction and the impact you expect. Remove credentials, tokens and personal data from logs before attaching them.

## What counts as a vulnerability

In scope:

- Bypassing capabilities or levels so a profile can use a tool, file or action it was not granted.
- Content from a web page, file, tool result or another person's message gaining the owner's authority.
- Credentials leaking into events, logs, prompts, transcripts or delivered messages.
- A channel or plugin accepting input from an identity it should reject, or sending to a target it should not.
- Escaping the declared boundaries of file tools, attachments or the `yonder` control socket.

Documented behavior, not vulnerabilities by themselves (see [README](README.md#security-model) and [spec 05](docs/spec/05-security.md)):

- The default owner profile runs at level `bypass`; `exec` can run any program and is not a sandbox.
- Plugins run in the kernel process without isolation.

---

## 简体中文

### 支持的版本

Yonder Harness 目前是开发者预览，只有最新发布版本会收到安全修复。

### 报告漏洞

请通过本仓库 *Security → Report a vulnerability* 页面**私下**报告漏洞，不要为疑似漏洞公开提交 issue 或 pull request。

请附上 `yonder version` 的输出、平台、涉及的插件、最小复现步骤和预期影响。附日志前请先去掉凭据、令牌和个人数据。

### 哪些属于漏洞

属于：

- 绕过能力或级别，让某个配置档使用了未授予的工具、文件或操作。
- 网页、文件、工具结果或他人消息中的内容获得了主人的权限。
- 凭据泄漏到事件、日志、提示词、转录或已发送的消息里。
- 渠道或插件接收了本应拒绝的身份的输入，或向不应发送的目标发送。
- 突破文件工具、附件或 `yonder` 控制套接字声明的边界。

已有文档说明、本身不算漏洞的行为（见 [README](README.zh-CN.md#安全模型) 与[规范 05](docs/spec/05-security.md)）：

- 默认 owner 配置档以 `bypass` 级别运行；`exec` 可以运行任意程序，不是沙箱。
- 插件与内核在同一进程内运行，没有隔离。
