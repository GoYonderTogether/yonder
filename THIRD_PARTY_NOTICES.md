# 第三方代码声明

## pi-durable 1.3.0 source fork

- Vendored workspace: `packages/pi-durable`, npm name remains `@earendil-works/pi-durable`, version 1.3.0.
- Fork: [GoYonderTogether/pi](https://github.com/GoYonderTogether/pi/tree/yonder/1.3/packages/durable), branch `yonder/1.3`, source commit `9060e7fa16681bf7ad572c4af56dc87e67a41309`.
- Base: earendil-works/pi tag v1.3.0, `71023aec1546d6d677a65669c5665c0927ce0dd0`.
- MIT, Copyright (c) 2025 Mario Zechner; full original license retained in [packages/pi-durable/LICENSE](packages/pi-durable/LICENSE). Boundary callback/abort queue continuation (D28), atomic run receipt (D29), retry hook and exhaustion reason (D44), interrupted-generation continuation (D49) are source changes described in FORK.md. No install-time patch remains.
- Tool-search relevance rules adapt [Hermes Agent](https://github.com/NousResearch/hermes-agent/blob/bf0203a794a07aac3ff764972ab9087baa4e4f4e/tools/tool_search_catalog.py), MIT, Copyright (c) 2025 Nous Research; the full applicable license and reference are retained in [packages/pi-durable/FORK.md](packages/pi-durable/FORK.md).
- Only durable is forked. pi-ai, chord, codemode, tui and coding-agent remain upstream npm dependencies. Refresh instructions: CONTRIBUTING.md; machine-readable provenance: packages/pi-durable/FORK_SOURCE.json.

## pi coding-agent 1.3.0

来源：[earendil-works/pi](https://github.com/earendil-works/pi)，npm 包 `@earendil-works/pi-coding-agent@1.3.0`。

- `packages/coding-agent/src/core/auth-storage.ts` 的 `FileAuthStorageBackend` 异步文件锁与读写语义，复制并适配到 `packages/core/src/runtime/credentials.ts`。没有复制同步缓存、命令凭据解析或其他程序的凭据。
- `packages/coding-agent/src/core/provider-composer.ts` 的模型字段缺省与合并逻辑，复制并适配到 `packages/core/src/runtime/models.ts`。
- `packages/coding-agent/src/core/model-config.ts` 的模型配置校验 schema，复制到 `packages/core/src/runtime/model-schema.ts`。

[原许可证](https://github.com/earendil-works/pi/blob/main/LICENSE)：

```text
MIT License

Copyright (c) 2025 Mario Zechner

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 原生 pi 终端界面 1.3.0

- 精确依赖 `@earendil-works/pi-tui@1.3.0`、`@earendil-works/pi-coding-agent@1.3.0`，来源 `earendil-works/pi` tag `v1.3.0`，沿用上述 MIT 许可证和版权。
- `packages/cli/src/pi-native.ts` 仅加载同包的 UI helper：`modes/interactive/chat-viewport.js`、`tui-renderer.js`、`theme/theme.js`、`components/status-indicator.js`、`core/keybindings.js`、`core/tools/renderers/index.js`、`theme/theme-controller.js` 的只读终端颜色查询 helper。默认布局、主题、键位和工具渲染直接使用上游代码。
- `packages/cli/src/vendor/pi-footer.ts` 提取自该 npm 包 source map 中原始 `packages/coding-agent/src/modes/interactive/components/footer.ts`；只将 AgentSession/SessionManager 数据访问换为实际 Yonder 控制面快照，移除 Yonder 未使用的实验/虚拟模型分支。展开时保留原有行布局、统计格式、样式和模型对齐渲染；按用户追加要求新增默认一行的折叠摘要。无 pi 会话文件、模型循环或第二 runtime。
- `terminal.ts` 直接使用上游 CustomEditor、AssistantMessageComponent、UserMessageComponent、ToolExecutionComponent、SessionSelectorComponent、ExtensionSelectorComponent ；数据与动作接 Yonder。会话删除改为明确拒绝并提示 `/close`，保留历史。

- 启动区域用原生 Text/Spacer 精简为品牌；消息组件外按用户要求适配灰色 inline gutter、灰背景与外层间距，底部微提示及有限键位适配见 spec/12 §6；不再提取上游长启动帮助模块。

## Codex 呈现参考

`packages/cli/src/message-presentation.ts` 的紧凑行首标记、正文缩进及背景混合规则参考 [openai/codex rust-v0.160.1 messages.rs](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/tui/src/history_cell/messages.rs)、[style.rs](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/tui/src/style.rs) 的设计；没有复制其 Rust 代码或运行时。实际内容渲染仍调用上述 MIT pi 组件。

## 官方插件及正文处理依赖

- BrowserSkill：适配 Tencent/BrowserSkill `f9b180bccbc79bd507d1ce292901170ca66e2abf`；安装指引核对 `d9a78aed47874459ae1e44523a597e42dd9acf99`。MIT，Copyright (c) 2026 Tencent。取用模块和完整许可证随包保留在 [NOTICE](plugins/browser-skill/NOTICE.md)、[LICENSE](plugins/browser-skill/LICENSE.browser-skill)。不打包浏览器引擎。
- 飞书：协议实现参考 OpenClaw `cafa09e50556e08c2a04a670f16ac815482c5489` 与 Hermes Agent `66605471e9f0b0832abbefaf625ce08e948ca540`，均为 MIT；模块归属见 [NOTICE](plugins/channel-feishu/NOTICE.md)，原文保留在 [OpenClaw LICENSE](plugins/channel-feishu/LICENSE.openclaw)、[Hermes LICENSE](plugins/channel-feishu/LICENSE.hermes)。正式依赖 `@larksuiteoapi/node-sdk@1.74.0`（MIT），许可证由 npm 包自带。
- Web 正文处理：`@mozilla/readability@0.6.0`（Apache-2.0）、`linkedom@0.18.13`（ISC）、`turndown@7.2.4`（MIT）、开发类型 `@types/turndown@5.0.6`（MIT）。使用 npm 原包及自带许可证；固定参考和取用边界见 [SOURCES](plugins/web-tools/SOURCES.md)。AI-Being 无已发现许可证，未直接复制其源码。
- GitHub 仅使用 `gh` 的固定 argv 调用外部已安装程序；参考项目与模块见 [包说明](plugins/channel-github/README.md)，不复制其运行系统。
- Codex Computer Use / hosted search 只通过外部已安装的 Codex app-server 连接；没有复制、重分发其私有插件或凭据。

新增插件源码由实际实现者提供，不因引用上游设计而宣称其授权、协议或真实使用已通过。


Skill Creator: copied from the local OpenAI Codex built-in skill-creator distribution, Apache-2.0; license retained at skills/skill-creator/license.txt. Default skill output location and discovery description adapted for Yonder Harness; supporting resources retained; SVG icon given an accessible title.

## 微信迁移

- 两个插件从自有 AI-Being/plugins/wechat-archive、wechat-ilink 迁移，归档同时参考自有 being/packages/wechat-inbox 和 wechat-context，来源说明见各插件 NOTICE.md。未复制旧生产配置、凭据、微信数据或旧宿主运行时。
- iLink 协议按 Tencent/openclaw-weixin 的公开协议文档实现，对照 Hermes Weixin 使用边界；未复制这两个项目的运行时代码。
- 微信语音解码使用精确版本 silk-wasm@3.7.1，保留 npm 包自带许可证；不提供或声称微信原生语音气泡发送。

## macOS permission guide

Yonder Helper links PermissionFlow (MIT), Copyright (c) 2026 小弟调调, pinned to cb96db4bfd2342e8d8c56f2a7d51ca65b8aed6e2. Upstream: https://github.com/jaywcjlove/PermissionFlow. Full license and NOTICE are retained in packages/macos-helper/. The small upstream-compatible API patch is retained at packages/macos-helper/patches/PermissionFlow-guide.patch; its FDA heuristic is not used.

## QQ 官方渠道依赖

`plugins/channel-qq` 使用腾讯公开发布的 `@tencent-connect/qqbot-nodejs@1.0.4`（MIT）与 `@tencent-connect/qqbot-connector@1.2.0`（npm 元数据 UNLICENSED，按其分发 README 使用公开扫码 API）。未复制、修改或重新许可其源码。版本、来源和接入边界见 [插件 NOTICE](plugins/channel-qq/NOTICE.md)。

## Official task prompt sources

`plugins/agent-presets/prompts/tasks/` adapts substantial prompt text from OpenCode (`4d30794bcf4dccdcadbcb1f62bb35b4943a96426`), CopilotKit OpenMuse (`1ac68f3909f2478ab6280883f1ab5ea65eb5719d`) and the installed Ponytail 4.10.0 skill distribution, all MIT. Exact inspected originals and full copyright/license notices are distributed in `plugins/agent-presets/prompts/upstream/`. [Source and adaptation map](plugins/agent-presets/prompts/SOURCES.md). These prompts do not import an upstream runtime or change its license; the original MIT notices continue to apply to the reused text.

## Hermes experience adaptation

- `plugins/hermes-experience` adapts Hermes Agent memory, skill and review policy at `4dcef215cfe41bd2d02c2d1dad6e257a18101216`, with earlier response-style guidance at `0eb4f62a8b35ff3b0454a8dbdbd3a7b55a6849b0`. MIT, Copyright (c) 2025 Nous Research.
- Exact source symbols, qualifications and retained permission are in [NOTICE](plugins/hermes-experience/NOTICE), [SOURCES.md](plugins/hermes-experience/assets/SOURCES.md) and [Hermes-MIT.txt](plugins/hermes-experience/assets/Hermes-MIT.txt). New native adapter contributions follow this repository’s Apache-2.0 license. No Python runtime or upstream skill corpus is bundled.
