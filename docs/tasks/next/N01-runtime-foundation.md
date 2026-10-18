# N01 配置一致性、运行终止与事件呈现

**状态**：部分实现并验证；运行配置边界阻塞，等待依赖适配方案裁定。N02 尚未开工。

**负责人**：Codex。

**依赖**：N00。

**功能依据**：10 §3–4；既有 05/07/08 修订后条款。完整条款见 [10](../../spec/10-local-maintenance.md)、[11](../../spec/11-official-plugins.md)，本任务不定义新功能。

## 允许路径

- packages/core/src/runtime/
- packages/core/src/prompt/index.ts 与对应 T08 检查：10 §3.1 的通用事件呈现
- packages/sdk/src/types.ts 与对应契约检查，仅本轮取消传播所需的兼容字段
- packages/core/src/sessions/index.ts
- packages/core/src/delivery/index.ts
- packages/core/src/config/、packages/core/src/kernel/index.ts 的配置接线
- 对应 T03/T05/T07/T09/T11 结果与检查

本任务文件、任务总表和必要 CHANGELOG 记录可更新；冻结功能文档仅 N00 的设计方可按批准修改。

## 实现安排

实现已批准的运行配置取值与上限，先消除影响安全运行的混用和失控路径；在统一输入准备入口实现 10 §3.1，避免自定义事件无 text 时内容丢失。其余恢复工作留 N05。

## 验证与交付

build/typecheck；真实 Luna 运行、配置下一轮生效、工具被拒仍受 maxTurns 约束、重复副作用停止点；检查无 text 的真实事件资料及名称换行/标记不会丢失数据或破坏框架。实际 release/卡片完整输入链由 N11/N13 验收，不虚构发布或回调；每个实际失败保留。

记录实际命令、event/session/model、commit/PR 与失败/跳过；Yonder 和 Codex 的贡献分开归属。

## 问题

### D-N01-01：锁定依赖缺少选择模型前的运行配置入口

- **已复现的实现问题**：`Runtime.submit()` 在排队前调用 `configure()`，会改正在运行会话的 `AgentDoc`；环境、工具上下文又分别读取最新 YAML。一次运行会混用配置。
- **真实证据**：2026-10-18，直接调用当前构建的 Runtime；session `2`，第一轮 run `10` 由 Luna 调用 `bash`，工具执行期间修改配置并提交排队输入，第二轮 run `15`。原生转录里的 assistant 模型依次是 `gpt-6-luna`、`gpt-6.1-sol`、`gpt-6.1-sol`。第一轮回答为 `first-complete`，第二轮为 `second-complete`；第一轮已经中途换模型。这是缺陷复现成功，不是配置一致性验收通过。
- **接口事实**：pi-durable 1.3.0 的 `GenerationTask.prepare` 先解析 agent/model，再构造 env 和 sections；`beforeRequest` 已在模型选择之后。`onYield` 能准备后续边界，但无法覆盖错误、取消和边界间的重载。`HarnessOptions` 没有对应启动回调，内置 GenerationTask 也不能被扩展替换。npm 当前发布版本仍为 1.3.0，官方源码入口为 `earendil-works/pi` 的 `packages/durable`。
- **设计裁定点**：建议给固定版本 pi 增加一个有限、可审核的适配补丁，在调度器选择 agent/model 之前调用宿主，再由 runtime 按原生第一条 submission 固定/恢复本轮配置。保留原生队列、模型循环和转录；不覆盖内置任务、不造第二套队列、不用模型别名绕过选择。
- **拟调整路径**：`package.json` 增加安装接线，拟新增 `patches/pi-durable-1.3.0.patch` 与 `scripts/apply-pi-patch.mjs`，runtime 使用该回调并补对应检查。补丁限定为调度器解析 agent 前的宿主回调，以及单运行终止后原生排队输入的收尾；不新增第三方依赖。先在设计记录中明确补丁来源/固定版本，再实施。功能承诺保持 10 §4。用户尚未答复这处依赖设计调整，当前未修改依赖、创建补丁或修改冻结规范。
- **同一收尾边界的缺口**：当前限额通过原生 `conversation.abort()` 停止；该接口按 pi 契约也撤销排队输入。单运行限额与显式会话 abort 仍需分清，后续原生边界适配必须验证排队输入的处置。不能把本次两个单运行检查扩大为完整队列验收。

### I-N01-02：现有类型检查脚本失败

`npm run typecheck`（`tsc -b --noEmit`）报 TS6310：引用项目 SDK 不可禁用 emit，exit 1。`npm run build` 和 `tsc -p packages/core/tsconfig.json --noEmit` 均通过。根脚本修正不在 N01 允许路径，记录至 N09 接续；不把构建通过写作该脚本通过。

### 验证中的失败记录

首次 kernel 检查：1 文件失败、2 测试失败。一个为沙箱禁止临时 Unix socket 监听（EPERM），另一个为新增验证输入缺少规范必需的 preset description；补齐验证输入并获准解除本次 socket 沙箱限制后，2 测试通过。未削弱断言。此前审查中的失败/跳过保持不变。

取消参数收敛时一次构建报 TS2379（fetch 不接受显式 undefined signal）；下载私有函数改为接收必需信号，由唯一调用方创建预算，最终构建通过。没有为此新增回退或配置。

## 结果

- **设计基线**：N00 冻结 commit `a4b4e73`；沿用 `39ed3a2` 的 AGENTS 授权，本次未改 AGENTS 或功能规范。
- **Codex 实现**：自定义事件完整 JSON 正文与 id/type；名称、附件标签单行转义；重载复用启动引用校验、拒绝删除开放会话引用的配置、创建新上下文模板后发布；保存的预设能力与当前能力取交集，session.input 保留附件并移除错误的会话 parent。
- **Codex 实现**：限额按原生第一条 submission 稳定计数；被拒工具同样经过轮次上限；重复参数用标准库语义比较，在触发 repeatStop 的副作用前停止；使用原生取消信号离开钩子，避免等待自身终止。SDK 增加已冻结的可选取消字段，输入准备将有限预算传给上下文与下载；完整取消链仍未验收。
- **本地检查**：相关检查合跑 4 文件、6 测试通过；真实 Luna 限额检查 1 文件、1 测试通过，最终逻辑调整后复跑同样通过。第一次读取 `/etc/hosts` 被工作区规则拒绝，只有一条 assistant，随后返回 maxTurns；第二次相同 bash 副作用在执行前停止，文件内容只有一次 `x`，返回 repeatStop。
- **事件资料**：通用呈现检查使用实际查询到的 OpenClaw Release `414373481` / `v2026.10.4`（上游发布时间 `2026-10-16T00:36:19Z`），没有虚构发布或卡片回调。端到端 release/卡片仍待 N11/N13。
- **命令**：`npm run build` 通过；`npx tsc -p packages/core/tsconfig.json --noEmit` 通过；相关 vitest 命令使用 source 路径并排除 dist，真实检查启用 `YONDER_TEST_REAL=1`。原 typecheck 脚本失败单独保留；全仓 lint、全套验收未重跑，留 N09/N14。
- **归属与边界**：本任务当前全部由 Codex 执行；还没有 Yonder MCP 任务、PR、安装、服务切换或发布。配置快照、生效时点、完整取消及队列终止尚未完成；N01 不记完成，N02/N03 不提前冒用完成状态。

