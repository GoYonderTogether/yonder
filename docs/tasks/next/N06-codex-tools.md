# N06 Computer Use 与 hosted search 连接

**状态**：已批准，待实施；先完成 N00 对齐与冻结。

**负责人**：Codex 核实本机连接；Yonder maintainer 实现适配。

**依赖**：N03。N00 可提前用已有入口试通；桌面与 hosted search 分别记录可用性。

**功能依据**：11 §3；10 §5。完整条款见 [10](../../spec/10-local-maintenance.md)、[11](../../spec/11-official-plugins.md)，本任务不定义新功能。

## 允许路径

- plugins/codex-tools/
- 根 workspace/锁文件接线、THIRD_PARTY_NOTICES.md
- 本任务获准的外部运行程序安装与插件配置，不复制专有实现到源码

本任务文件、任务总表和必要 CHANGELOG 记录可更新；冻结功能文档仅 N00 的设计方可按批准修改。

## 实现安排

承接 N00 的真实探测，验证可调用后端和实际 app-server 协议，固定一种桌面路径；再由 Yonder 实现插件工具、状态和说明。替代后端仅在原路径真实不可用时选定。按 10 §2.1 安装插件后在 Yonder 中调用，不能把宿主 Codex 的独立调用记作 Yonder 已接通。

## 验证与交付

Yonder 读取获准桌面应用并完成可逆动作；一条真实 hosted search 具有 native webSearch 记录及来源。两项独立记通过/阻塞，桌面通过即可供 N13 使用；任一失败不阻塞 N07/N08/N09/N10。目标仍保留，不能以其他供应商成功代记通过。

记录实际命令、event/session/model、commit/PR 与失败/跳过；Yonder 和 Codex 的贡献分开归属。

## 问题

待实现时记录。当前没有运行通过的声明。

## 结果

尚未开始。


### N00 前置探测（2026-10-18）

- 宿主 cua.getState 成功返回实际应用/浏览器清单，没有前台交互；尚未通过 Yonder/插件调用。
- 现有 Codex 登录下，codex --search exec --json --ephemeral --sandbox read-only --model gpt-6-luna 实际完成一次 native web_search，结果返回公开官方文档 URL；临时证据 /tmp/yonder-hosted-search-probe.jsonl。进程退出码 0，伴随既有 chronicle/SessionEnd 配置警告，不是搜索失败。
- 两项仅证明已有宿主入口可调用；安装版 Yonder 的真实接线和授权边界仍属 N06。
