# N01 配置一致性、运行终止与事件呈现

**状态**：基础实现完成，配置/限额/取消边界检查通过；恢复及输入准备组合缺口随 N05/N09 继续，不宣称全功能验收。进入 N02。

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
- 用户追加批准的依赖适配：package.json 的 postinstall、patches/pi-durable-1.3.0.patch、scripts/apply-pi-patch.mjs；设计方限本次 D28 对应的 07 运行时条款与决策记录

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
- **已批准路径**：`package.json` 的安装接线、新增 `patches/pi-durable-1.3.0.patch` 与 `scripts/apply-pi-patch.mjs`、runtime 与相关检查。用户明确批准最小原生回调并要求继续设计执行，设计记录见 D28。补丁限定为调度器解析 agent 前的宿主回调，以及单运行终止后原生排队输入的收尾；不新增第三方依赖。功能承诺保持 10 §4。
- **同一收尾边界的缺口**：当前限额通过原生 `conversation.abort()` 停止；该接口按 pi 契约也撤销排队输入。单运行限额与显式会话 abort 仍需分清，后续原生边界适配必须验证排队输入的处置。不能把本次两个单运行检查扩大为完整队列验收。

### I-N01-02：现有类型检查脚本失败

`npm run typecheck`（`tsc -b --noEmit`）报 TS6310：引用项目 SDK 不可禁用 emit，exit 1。`npm run build` 和 `tsc -p packages/core/tsconfig.json --noEmit` 均通过。根脚本修正不在 N01 允许路径，记录至 N09 接续；不把构建通过写作该脚本通过。

### 接续 N05/N09 的明确缺口

- 原生扩展文档已保存配置、开始时间、计数、重复参数与终止原因；跨重启输入关联、终结及缓存回收尚未做完整运行验收，归 N05。
- 排队输入的 turn 贡献与图片筛选仍在接收阶段准备，尚未按实际开始运行的快照重组；这是遗留实现缺口，归 N09 的输入/附件/提示检查。当前官方 context-files 均为 system 贡献，已在原生开始回调后按快照组装；不能据此声称任意 turn/附件路径完整符合 10 §4。
- 输入准备已有独立有限预算；显式会话 abort 与尚未进入 pi 的准备工作关联仍待 N05 统一接纳链处理。skill 索引 IO 的完整取消检查归 N09。

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
- **8e50b0b 阶段归属与边界**：当时全部由 Codex 执行，尚无 Yonder MCP 任务、PR、安装、服务切换或发布；配置快照和队列终止尚未完成，因此未提前放行 N02/N03。后续变化见 D28 结果。

### D28 实施结果

- 设计先提交 `eaf9c78`；随后增加 npm 1.3.0 的三个文件补丁与根 postinstall，使用系统 patch，无新增第三方依赖。实际应用及再次应用均成功；版本/补丁不匹配会失败。
- runtime 在原生解析 agent/model 前创建按首条 submission 区分的 pi 扩展文档，配置与预算从此固定；模型、能力、工具、环境、system 上下文、skill 选择及投递读取本轮配置。移除排队时 configure 与冗余 fingerprint 缓存。
- 限额中止当前 generation，原生 final 边界继续排队输入；显式会话 abort 保留原生撤销排队输入语义。原生取消传入插件工具、system 渲染及工作区 IO；渠道发送接收可选取消信号和有限投递预算。
- **真实复现前后对照**：原 session `2` / run `10,15` 为 Luna→Sol→Sol；补丁后独立 session `2` / run `10,16` 为 Luna→Luna→Sol，两轮均正常完成。
- **真实边界检查**：2 文件、3 测试通过（32.30 秒）；包括排队已接纳后再改为 Sol/readonly，当前 Luna 仍能执行第二个 bash，下一轮才切换；maxTurns 停止前一轮后下一轮仍完成；渲染预算在任何模型请求前取消、费用为 0；原限额检查仍通过。无假模型。
- **类型检查中的修正**：pi 文档要求严格 JSON，配置与重复参数使用 JSON 编码，family 显式声明并提供原生 seed；新增检查中可选 tools 取空数组。首次编译错误保留为开发记录，修正后执行最终 build/core 类型检查。
- **最终本地检查**：build 通过；kernel/delivery/prompt/runtime 合跑 4 文件、6 测试通过。改动文件 Biome 无错误、2 条内部原生取消信号的非空断言警告；未宣称全仓 lint 通过。
- 尚未安装、发布或由 Yonder 执行；上列 N05/N09 缺口保留。N01 的基础边界已具备继续 MCP 的条件，任务状态不等于完整跨重启/附件验收。

