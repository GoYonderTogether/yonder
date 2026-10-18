# 下一阶段实施任务

**状态：2026-10-18 用户已授权补齐并启动，先执行 N00。** 本轮功能以 [10](../../spec/10-local-maintenance.md)、[11](../../spec/11-official-plugins.md) 为准。这里不定义功能。原 T00–T14 保留，N 任务引用其原验收，不能用新编号清掉历史失败或跳过。

参考更新和本机只读状态见 [reference-sources.md](reference-sources.md)。它记录证据，不新增需求。

## 任务清单（列出的均为硬依赖）

- 🟢 [N00](N00-contracts.md) 设计锁定与旧规范对齐｜Codex｜无依赖。
- 🟢 [N01](N01-runtime-foundation.md) 基础边界已实现并检查；恢复/输入组合缺口挂 N05/N09｜Codex｜N00。
- 🟢 [N02](N02-mcp.md) MCP 已实现，开发版真实 Luna 检查通过，安装版复验挂 N03｜Codex｜N01。
- 🟢 [N03](N03-install-agents.md) 独立安装、阶段更新、常驻服务、Luna/Sol 与两个真实 agent 已验证｜Codex｜N02。
- 🟢 [N04](N04-first-repair.md) Luna 首个自主修复已提交、整合、安装及真实转换复验｜Yonder，Codex 审查｜N03。
- 🟡 [N05](N05-recovery.md) 持久输入、运行恢复和投递归属：原生关联核对｜Yonder，Codex 主持架构｜N04。
- ⚪ [N06](N06-codex-tools.md) Computer Use 与 hosted search 本机连接｜Codex 连接，Yonder 插件实现｜N03；N00 可提前试通。
- ⚪ [N07](N07-browser.md) BrowserSkill 默认插件与安装引导｜Yonder｜N03；引导可用系统打开 URL。
- ⚪ [N08](N08-coding-web.md) grep/Bash、Tavily、Web Fetch｜Yonder｜N03；不依赖 hosted search 或浏览器。
- ⚪ [N09](N09-sol-tests.md) Sol 接入、补测试与原契约缺陷修复｜Yonder｜N05、Sol 实际可用；不等 N06–N08。
- ⚪ [N10](N10-github.md) issue→设计→commit→PR→Codex 合并｜Yonder｜N09。
- ⚪ [N11](N11-release-update.md) 发布事件与 operator 安装更新｜Yonder｜N10。
- ⚪ [N12](N12-feishu.md) 飞书完整渠道开发｜Yonder｜N09；不等 GitHub 发布链。
- ⚪ [N13](N13-feishu-live.md) Computer Use 验证真实飞书矩阵｜Yonder 执行，Codex 观察｜N12、N06 桌面能力、已安装飞书包与真实授权。
- ⚪ [N14](N14-acceptance.md) 整条自维护链与全部剩余验收｜Yonder + Codex｜N01–N13 各能力验收；任何未通过项保留。

## 执行与检查

1. 用户已授权本轮实施。N00 先统一新旧规范并记录冻结 commit，随后按依赖连续推进；不重复请求整轮或普通任务批准。后续实现者不能修改功能规范。
2. 每项读取其功能依据、现有源码、相关调用者与失败路径，再实现；涉及参考项目时记录固定 commit/模块。
3. Codex 经 MCP 下发允许路径和验收；Yonder 的事件、会话、转录、模型、diff、commit、PR 形成任务证据。没有这条证据链的部分归实际执行者。
4. 不同包的独立阅读与检查可并行；跨 SDK/core 或同路径修改顺序执行。默认不另开 Codex 子 agent 实现任务。
5. 相关检查通过后结束该任务；N09 实现并执行当前已具备条件的全部原验收，缺未来能力的项目明确挂接 N11/N13/N14。N14 执行剩余与跨能力整体验收，不重复无变化且无疑点的检查。
6. 发现问题立即写当前任务“问题”；实现缺陷按冻结契约修，设计变更交用户审核。Yonder 阻塞由 Codex 介入，并如实记录。
7. 一个任务一个提交边界；涉及旧 T 任务修复时保持按原领域拆提交。当前 PR 由 Codex 审核合并，发布/更新按已批任务范围执行。

## 前置试通与阶段安装

- N00 使用已有入口对 Computer Use、hosted search、Sol 做最小可逆探测，证据分别记 N06/N09；缺授权列具体阻塞，继续 N01。后端选择按 11 §3，未调用成功不记选定。N03 在安装版 Yonder 内验证实际 provider/model ID，N06 完成桌面/搜索的 Yonder 工具链验收。
- N03 由 Codex 实现并验证 10 §2.1 的首次和阶段安装；N04/N05 的核心修复及 N06–N13 的插件在被后续任务使用前，安装切换与真实调用证据随任务交付。自动更新未接通时由 Codex 从服务外部执行，不等待 N11，也不由正在被替换的任务更新自身。
- 阶段安装共用允许路径：已批准的安装/home/本项目 launchd 配置；发行元数据限根及 workspace 包的 version、相应锁文件与 CHANGELOG。由 Codex 单独管理发行提交和本地标签，不扩展各任务业务源码范围；安装器缺陷回 N03/N11 的路径处理。
- 更新后确认安装包含新增插件、批准配置已生效，保留 executable/version/commit/home/pid 和一次 MCP 调用证据。不同源码不得复用同一安装版本。N11 正式发布由 Codex 创建 GitHub Release，operator 接手更新后仍执行同样核对。
- N05 写代码前，Codex 在该任务结果中记录运行事实来源、关联持久化、配置快照、终结/投递负责点及拟删除状态，再让 Yonder 实现；规约内技术方案不增加用户审批轮。

## 任务记录格式

每项已列负责人、依赖、规范、允许路径和验证入口。实现结束追加：变化、实际命令/结果、event/session/model/commit/PR、未完成项。原始失败和跳过计数不删除。
