# 本轮参考快照与本机证据

采集日期：2026-10-18。供实现导航与复核，不定义功能。参考更新获用户明确授权；以下是本次操作结束时的快照，不承诺之后上游不再变化。

## 已更新的上游

- **OpenClaw**：`main` 快进至 `cafa09e50556e08c2a04a670f16ac815482c5489`，工作区干净；原 `7924f12c` 审查证据属于历史快照。
- **Hermes Agent**：`main` 快进至 `0eb4f62a8b35ff3b0454a8dbdbd3a7b55a6849b0`，工作区干净；原 `6e7b83a2` 证据保留历史归属。
- **OpenCode**：临时参考检出 `dev` 快进至 `214fb7fdbab9ad13773629839f1178382400cf97`；此次更新未改已读 session/tool 模块。
- **BrowserSkill**：已 fetch 官方 origin，`origin/main=d9a78aed47874459ae1e44523a597e42dd9acf99`。原 `feat/bookmarks-api=f9b180b` 功能分支没有 upstream，未擅自合并 main；最新安装说明已通过 git show origin/main 读取。
- **open-computer-use**：新临时只读参考检出 `5136415f52b87f419227bae28767cf469a6bc3b5`。
- **AI-Being**：本机源码 `8aa49512`，只读参考，未 pull 或修改用户工作项目。

## 功能到源码的导航

- 恢复/运行：OpenCode `packages/core/src/session/execution.ts`、`execution/restart.ts`；OpenClaw agent-loop 与会话输入；Hermes `agent/conversation_loop.py` 与 session lifecycle。Yonder 复用 pi，借鉴行为和边界，不搬入另一套调度核心。
- Codex hosted search：OpenClaw `extensions/codex/src/web-search-provider.runtime.ts`、`app-server/bounded-turn.ts`、`web-search.ts`、`web-search-item.ts`。最新版仍检查实际 native webSearch 记录后返回来源。
- Computer Use：OpenClaw `docs/plugins/codex-computer-use.md`、`extensions/codex/src/app-server/computer-use*` 与 `native-mcp-app.ts`；OpenAI app-server 的 MCP 发现/调用文档。是否可在 Yonder 中直接调用尚待 N06 实测。
- BrowserSkill：官方最新 `AGENT_INSTALL.md`、`crates/bsk-cli/skill/`、`packages/dsh-plugin-browserskill/`。移植 CLI/会话/结果适配，不迁移 DSH UI 和内部宿主实现。
- grep：OpenCode `packages/core/src/tool/plugin/grep.ts`、`ripgrep.ts`；Hermes `tools/file_operations_search.py`。Yonder 的 pi 1.3.0 coding-tools 实际仅 read/write/edit/bash，grep 是当前确有的缺口。
- Web：AI-Being `src/tools/web.ts`；Hermes `tools/web_tools*.py`；OpenCode `packages/core/src/tool/plugin/webfetch.ts`、`websearch.ts`；OpenClaw Codex search。当前 AI-Being 源码使用 LocalCredentials，而旧 C4 文档提到的 network 配置已过时，不能据旧文档复制凭据接线。
- 飞书：OpenClaw `extensions/feishu/src/{config-schema,bot,monitor,send,media,streaming-card,card-action}.ts`；Hermes `plugins/platforms/feishu/{adapter,send_targets,feishu_admission_diagnostics,feishu_comment}.py` 与对应 tests。最新版已定位发送、多媒体、CardKit start/update/close 与配置；完整模块阅读、选择和移植属于 N12，不声称规划阶段已完成全部实现审查。

## 只读本机探测

- bsk CLI 存在；本次使用 `BSK_AUTO_START=0 bsk status --json` 未连到 daemon。没有启动、重启或安装扩展，也没有判定扩展一定不存在。
- 已找到 `~/.codex/computer-use/Codex Computer Use.app` 和缓存插件清单；清单标为 Proprietary。只检查文件与元数据，没有复制程序、申请系统权限或执行桌面操作。
- codex CLI 的 app-server 与 live web_search 入口存在；官方文档列有 mcpServerStatus/list、mcpServer/tool/call。入口存在不等于 Yonder 接入或该账号搜索已验收。
- 默认 `~/.ai-being/network.json` 存在，未发现旧 tavilyCredentialRef；默认 credentials.json 不存在。这不证明实际运行中的 AI-Being 没有搜索配置：其实际 home/版本尚未确定。本轮不读取秘密或复制其 OAuth。
- 没有执行 Yonder 安装、GitHub/飞书授权、外部发消息、Computer Use 或新增插件模型调用。

## 官方与上游入口

- [OpenAI App Server](https://learn.chatgpt.com/docs/app-server)
- [OpenAI Web Search API](https://developers.openai.com/api/docs/guides/tools-web-search)
- [OpenClaw Codex Computer Use](https://docs.openclaw.ai/zh-CN/plugins/codex-computer-use)
- [open-computer-use](https://github.com/iFurySt/open-computer-use)
- [BrowserSkill 安装说明](https://github.com/Tencent/BrowserSkill/blob/d9a78aed47874459ae1e44523a597e42dd9acf99/AGENT_INSTALL.md)
- [飞书 CardKit](https://open.feishu.cn/document/cardkit-v1/card-element/content)

OpenAI API 的 hosted search 文档不是 ChatGPT 登录态适配的证明；本轮登录态路径参考实际 Codex app-server。飞书官网页面本次读取仅返回页面标题，具体行为还须对照官方 SDK/接口及真实 N13 验收，不把网页空正文当作已核验。
