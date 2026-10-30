<div align="center">

# Yonder Harness

**常驻的 Agent 内核。任何消息都是事件，由 harness 分发给指定 Agent 的指定会话，完成工作后把结果交回去。其余能力都是插件。**

[English](README.md) · **简体中文**

[项目状态](docs/status.md) · [文档](docs/index.md) · [插件](docs/plugins.md) · [参与开发](CONTRIBUTING.md) · [安全](SECURITY.md) · [许可证](LICENSE)

[![CI](https://github.com/GoYonderTogether/yonder-harness/actions/workflows/ci.yml/badge.svg)](https://github.com/GoYonderTogether/yonder-harness/actions/workflows/ci.yml) [![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

</div>

> **开发者预览，仅支持 macOS。** 内核、CLI 与终端界面、安装更新和 12 个官方插件已端到端跑通。新安装默认只启用 CLI 渠道和工作区上下文文件，其他能力按配置启用。已验证什么、缺什么、哪些还没测，见 [docs/status.md](docs/status.md)。

## 为什么是 Yonder Harness

- **小内核，一切可插拔。** 内核只负责事件、绑定、身份、会话、安全级别和投递。渠道、工具、上下文、触发器、执行环境、钩子、预设和 skill 都由插件提供，插件只依赖 [`@yonder/sdk`](packages/sdk)。
- **事件，而不是聊天窗口。** 任何渠道、触发器或其他 Agent 的消息都成为只追加的事件。声明式的绑定决定每个事件进入哪个 Agent、哪个会话、哪个配置档，以及是否唤醒模型。
- **持久会话。** 模型访问与持久化 Agent 会话使用 [pi](https://github.com/earendil-works/pi)（`pi-ai`、`pi-durable`）作为依赖；Yonder 负责 pi 不管的那一层：事件、渠道、绑定、身份、Agent 工作区、安全级别、投递和插件。
- **只有一层安全。** 能力加级别，只在两处判定：工具是否提供给模型，调用前是否放行。没有第二套审批机制，需要时用钩子插件实现。
- **Agent 维护自己的系统。** 有 `exec` 的 Agent 可以使用 `yonder` CLI 和 `yonder docs`，内置提示词与 skill 引导它们查看、配置并扩展自己的安装。

## 工作方式

```
渠道 / 触发器 / agent_ask ──事件──▶ 绑定 ──▶ 会话 ──▶ 运行（模型 + 工具 + skill）──▶ 投递
                                     │         │                                    │
                                   身份      配置档                       回到该输入的来源 /
                                （谁是谁）（模型、工具、级别）          流式 / 主动发送 / 返回给等待者
```

先读 [docs/architecture.md](docs/architecture.md)，再读 [docs/spec/](docs/spec/) 下的规范。

## 快速开始

环境：macOS、Node.js 22.19 或更新版本、git。可选：[ripgrep](https://github.com/BurntSushi/ripgrep)（`grep` 工具）、[`gh`](https://cli.github.com)（GitHub 插件）、Chrome 或 Edge（浏览器自动化）。

```sh
git clone https://github.com/GoYonderTogether/yonder-harness.git
cd yonder-harness
npm ci
npm run build
node packages/cli/dist/index.js init ~/yonder-home
node packages/cli/dist/index.js login openai --home ~/yonder-home
node packages/cli/dist/index.js start --home ~/yonder-home
```

`init` 创建一个 home：一个 Agent（`main`，默认模型 `openai/gpt-6-luna`）、CLI 渠道和工作区上下文文件。`login openai` 通过 pi 使用 ChatGPT 订阅登录；其他供应商在 `yonder.yaml` 中配置（见 [规范 08](docs/spec/08-config.md)、[规范 07](docs/spec/07-runtime.md)）。不要复制其他程序或其他 home 的 OAuth 凭据：刷新会轮换 refresh token，复制出来的两份会互相失效。

`start` 在前台运行。另开一个终端：

```sh
node packages/cli/dist/index.js chat --home ~/yonder-home
```

这会打开 pi 1.3.0 原生风格的 TUI，默认是独立、可续聊的任务（首次发送才创建会话）。`/new`、`/resume`、`/session` 与 pi 一致；`/` 和 Tab 使用原生补全，菜单说明为中英文。退出界面不会停止已接纳的任务，用 `/stop` 明确中止。详见[终端规范](docs/spec/12-terminal-interaction.md)。

### 安装为后台服务（macOS）

```sh
node packages/cli/dist/index.js update --to latest   # 把最新发布标签构建到 ~/.yonder-harness/versions
export PATH="$HOME/.yonder-harness/bin:$PATH"
yonder init && yonder login openai
yonder service install                               # 为该 home 安装 launchd 服务
yonder                                               # 进入常驻 main 会话
```

`yonder service status|restart|stop|start|uninstall` 管理服务，`yonder update --check` 查询最新正式发布，`yonder version`、`yonder changelog`、`yonder docs` 查看已安装版本的信息。安装目录保存带版本的程序，home 保存数据，一个安装可以服务多个 home。详见[规范 09](docs/spec/09-cli-release.md)。

### 日常命令

```sh
yonder chat --channel cli            # 通过 CLI 渠道进入常驻 main 会话
yonder chat --plain                  # 逐行输入输出
yonder sessions list | show <id> | open <preset> | submit <id> --text '…'
yonder events | identity | skills | plugins | models list | inspect | doctor
source <(yonder completion zsh)      # 也支持 bash、fish；不会修改 shell 配置
```

管理命令均为非交互，支持 `--json`，退出码稳定。

## 目前随发行提供的能力

| 方面 | 插件与内置能力 |
|---|---|
| 渠道 | CLI、MCP 服务端（外部 Agent 控制 Yonder）、GitHub（issue、PR、发布）、飞书/Lark |
| 工具 | 文件读写、带后台任务的 bash、ripgrep 搜索、`task_run` 子任务、`agent_ask`、网页搜索与抓取、BrowserSkill 浏览器控制、Computer Use 桥接、独立 Playwright 浏览器与 macOS 桌面自动化、MCP 客户端、cron 调度、图片生成与语音识别（硅基流动） |
| 上下文与 skill | `AGENTS.md` / `USER.md` / `SOUL.md` / `MEMORY.md` 上下文文件；兼容 Agent Skills 的 `SKILL.md` 目录与按需 `skill_view`；内置 `skill-creator`、`yonder-development`、`yonder-plugin-debug`、`yonder-self-management` |
| 运维 | 工具超过 15 秒转入后台、时间/轮数/tokens 软提醒、Agent 与预设热管理、带版本的安装与 launchd 服务、GitHub 发布 → 自动升级 → 通知 |

每个插件的贡献、事件和工具见 [docs/plugins.md](docs/plugins.md)，注册名见 [docs/reference.md](docs/reference.md)。

## 开发插件与 skill

插件是带 `yonder` 清单（写在 `package.json` 里）的 npm 包或本地目录，通过 SDK 的插件 API 注册贡献；除 [`@yonder/sdk`](packages/sdk) 外不依赖 Yonder 的任何内部代码，`@yonder/sdk/testing` 提供契约测试用的 `checkPlugin`。skill 是含 `SKILL.md`（frontmatter 带 `name` 与 `description`）的目录。从[插件规范](docs/spec/04-plugins.md)、[Agent 规范](docs/spec/03-agents.md#6-skill)和 [plugins/](plugins/) 下的现有插件开始。

## 安全模型

把 Agent 接到重要的机器之前请先读这一节。

- `init` 创建的 owner 配置档以 `bypass` 级别运行并提供全部工具。`exec` 可以运行任意程序，因此 Agent shell 里的 Yonder CLI 等同于管理权限；文件作用域规则不是沙箱。
- 插件与内核在同一进程内运行，没有隔离。只安装你信任的插件。
- 网页、日志、引用内容和他人的消息一律作为数据处理，不是指令，也不带有主人的授权。
- 凭据保存在各 home 的凭据文件中，只经凭据 API 读取。详见[规范 05](docs/spec/05-security.md)。

报告安全漏洞请见 [SECURITY.md](SECURITY.md)。

## 文档

| | |
|---|---|
| [docs/index.md](docs/index.md) | 全部文档的地图 |
| [docs/architecture.md](docs/architecture.md) | 概念、职责划分和任何改动都不得违反的不变量 |
| [docs/spec/](docs/spec/) | 规范，即代码要达到的目标 |
| [docs/decisions.md](docs/decisions.md) | 设计取舍及理由 |
| [docs/status.md](docs/status.md) | 已实现什么、缺什么、哪些未测 |
| [CHANGELOG.md](CHANGELOG.md) | 版本变更记录 |

## 参与开发

请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。需要模型的测试使用真实模型，不使用模拟；缺少凭据时会被跳过并记为未测。

## 许可证与致谢

Apache-2.0，见 [LICENSE](LICENSE)。Yonder Harness 构建在 [pi](https://github.com/earendil-works/pi)（MIT）之上，并按各自的 MIT 许可改编了 pi coding-agent、[OpenClaw](https://github.com/openclaw/openclaw)、[Hermes Agent](https://github.com/NousResearch/hermes-agent) 和腾讯 BrowserSkill 的代码或协议行为。来源与许可证原文见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和各插件目录。

## 原生 Windows 候选

平台约定和真实验证见 [Windows 适配](docs/windows.md)。安装包含 npm 的 Node.js 与 Git，在本检出执行 `npm ci`、`npm run build`。沿用 init/login/start/chat 命令；Agent 的 bash 工具在此平台实际执行 Windows PowerShell。

后台 service 使用当前用户登录计划任务；update 仍从审核 tag 构建，安装生成 bin/yonder.cmd 并切换 junction。只有包含本次适配的审核版本才能用于 Windows 安装；旧发布标签不会因调用方更新而变成 Windows 版本。安装后按 Windows 常规方式把安装 bin 加入 PATH。每个 home 独立登录，禁止复制 OAuth。

Windows 已补对应的 Win32/UI Automation、系统托盘与固定运行入口、DPAPI 当前用户秘密存储、电源租约和独立升级计划任务。Windows 不伪造 macOS TCC 状态，不覆盖合盖/手动休眠策略。全量、真实桌面/服务、ConPTY 及尚待 OAuth/整机重启的验收事实见 status 与 docs/verification/windows-20261030.md。BrowserSkill 外部 macOS daemon 仍属原平台，Windows 可用独立 Playwright 浏览器。
