---
name: yonder-self-management
description: 管理 Yonder Harness 自身的运行目录、配置、身份、常驻 Agent、预设、委派、模型与服务，以及检查、重载和更新。用于改变或解释本系统的运行方式；不用于普通编码、修复或 GitHub 操作。
---

# Yonder 自管理

本 skill 补充 Yonder 的系统事实，不授予管理、发送、提权或更新权限。按当前请求和实际能力操作。

先确定操作的是哪个 home、哪个已安装版本、哪个 agent/profile；不要把源码 checkout 当成运行安装。用 `yonder version --json`、`yonder service status --json`、`yonder service info --home <home> --json` 核对；后续管理命令显式带 `--home <home>`。

按需读取 [管理事实](references/management.md)：

- 配置、权限与身份：第 1–2 节。
- 新常驻 Agent、preset、子任务或助理：第 3–4 节。
- 模型和非对话服务：第 5 节。
- 生效检查、热重载、安装更新：第 6 节。

以当前安装的 `yonder --help`、`yonder docs --list` 和 `yonder docs <path>` 查询版本对应文档；本文不是对尚未提供的 CLI 或插件的承诺。工具不在当前列表时，仅在已提供 `tool_search` 的情况下用它搜索；否则用可用的 `yonder inspect` 或插件清单核对，不调用未提供的工具。
