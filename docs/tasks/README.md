# 0.1 任务

## 当前状态（2026-10-19）

当前为文档归档与待审收尾阶段，见[现状总账](current-status.md)、[Hermes当前表](hermes-capability-comparison.md)、[插件目录](../plugins.md)。R/F/D36/D37已有实现与部分实证，旧轮“不测试”限制不描述后续已获准且已执行的R轮。本次仅整理文档；不启动开发、测试、安装或发布。后续收尾须审核[最小方案](finishing-plan.md)。

| 任务 | 当前结论 | 剩余安排 |
|---|---|---|
| T00/T01 | 原任务完成 | 不重做 |
| T02–T07 | 已实现并经后续修复，有自动检查及部分原生运行/权限/路由证据 | P0/P1/P5核对未覆盖组合 |
| T08 | 上下文组装已实现，D36进入1902；迟到消息语义未验收 | P0 |
| T09/T10 | 共享投递与首批插件已安装，具体渠道场景通过 | P1/P5补剩余矩阵 |
| T11 | 全局入口/TUI已安装，真实PTY基本路径通过 | P2 |
| T13 | skills发现/读取/管理及内置creator已有实现 | P2/P4补辅助依赖和真实开发使用 |
| T14 | 独立安装及1805更新链通过，1902日用入口通过 | P2/P5补新用户、自启和交付 |
| T12 | 部分端到端已执行；整体未关闭，不能继续仅写“待做” | P5按当前规范与E证据逐项核对 |

详细原始任务状态表仍保留在下面，属于首轮快照。

## 历史任务与结果（原文保留）

以下状态、版本及执行要求按记录当时理解；不作为当前派工指令。

任务文档是目录：每条任务只写"做什么、依据哪几行规范、改哪些路径、怎么验收"。设计以 `docs/spec/` 为准，任务文档不重复设计内容。

## 当前工位（2026-10-18 最新批准）

当前执行用户已批准的 [R0–R6 修复与真实安装验收](repair-acceptance-plan.md)，D1–D4 已冻结，三个 Sol 分路和核心修复已整合。允许补测试、运行测试、独立安装及真实模型/渠道验收；这些授权取代先前 C0–C6 的“不测试、不安装”限制，原历史不改写。

主路真实证据、原始失败/跳过、安装版本和尚未闭环项目见 [repair-main-result.md](repair-main-result.md)。GitHub 自主维修见 [R5 实际任务](repair-r5-feishu-errors.md)。功能体或接口存在仍不计验收通过；未经逐项真实验证的 T/N/U 条目继续保留。

## 状态

| 任务 | 内容 | 依赖 | 状态 |
|---|---|---|---|
| [T00](T00-pi-spike.md) | 验证 pi 能力，把结论写回规范 | — | 完成 |
| [T01](T01-scaffold.md) | 仓库骨架与工具链 | T00 | 完成 |
| [T02](T02-sdk.md) | SDK 类型与契约测试 | T01 | 已实现（待验收） |
| [T03](T03-config.md) | 配置加载、校验、热重载 | T02 | 已实现（待验收） |
| [T04](T04-store.md) | 事件、会话元数据、身份的存储 | T02 | 已实现（待验收） |
| [T05](T05-runtime.md) | pi 适配层：模型、凭据、会话、钩子、上限 | T00 T03 T04 | 已实现（待验收） |
| [T06](T06-plugins.md) | 插件加载 | T02 T03 T10 | 已实现（待验收） |
| [T07](T07-routing.md) | 绑定解析与会话管理 | T04 T05 T06 | 已实现（待验收） |
| [T08](T08-prompt.md) | 提示词组装 | T05 T06 T10 | 已实现（待验收） |
| [T09](T09-delivery.md) | 投递与内置工具 | T07 T08 T10 | 已实现（待验收） |
| [T10](T10-first-plugins.md) | channel-cli 与 context-files 插件 | T02 | 已实现（待验收） |
| [T11](T11-cli.md) | CLI 与本地控制接口（完成后 CLI 可用） | T07 T09 T10 | 已实现（待验收） |
| [T13](T13-skills.md) | skill 发现、索引与 `skill_view` | T08 T09 T11 | 已实现（待验收） |
| [T14](T14-release.md) | 安装、更新、服务、版本通知 | T11 T13 | 已实现（待验收） |
| [T12](T12-acceptance.md) | 0.1 端到端验收 | 以上全部 | 待做 |

状态：待做、进行中、已实现（待验收）、阻塞、完成。**已实现不是验收通过**；原验收条目全部保留到第二轮。

## 两轮执行（2026-10-18 用户批准）

第一轮：工序 0 修正文档并提交后冻结设计；按下列顺序连续实现全部 T02–T14，不在每步重新请求批准。只做必要的 build/typecheck、最小可运行检查及最终默认模型启动检查；不展开复杂测试、全功能测试或反复修 bug。已发现问题写回任务的“问题”，继续其余实现。影响编译、组装、启动的必要接线在本轮完成；未明的产品语义不自行补设计。到 T14 停下，交用户审核实现与问题。

第二轮：用户审核后再开始；讨论需要的设计修订，执行所有原定任务验收、完整功能补测试和 bug 修复，最后执行 T12。缺凭据明确记未测，不用模拟模型代替。第一轮不把 T12、正式发布或日用部署标为完成。

| 工序 | 任务 | 并行与独占 |
|---|---|---|
| 0 | 文档修订和设计锁定 | 主 agent；本节与 decisions 记录本次授权 |
| 1 | T02 | SDK 先完成 |
| 2 | T03、T04、T10 | 可并行，分别 config、store/db、两个插件 |
| 3 | T05、T06 | 可并行，分别 runtime、plugins |
| 4 | T07、T08 | 可并行，分别 routing/sessions、prompt |
| 5 | T09 | delivery/tools |
| 6 | T11 → T13 | 同一负责人顺序修改 CLI |
| 7 | T14 | CLI/release；本轮终点 |
| 8 | T12、正式发布和日用交接 | 第二轮，经用户审核再执行 |

## 实现循环

1. 开始读 AGENTS、index、architecture 与对应任务。已有读取仍有效时不重复。主 agent 在干净分支开始工作，子 agent 不自行 pull、切分支或 push。
2. 选择依赖已实现的任务，标为进行中；并行任务只修改各自路径。实现者不修改冻结的规范。
3. 完整实现任务必须项；能复用现有代码、pi、标准库或已装依赖就直接复用。规范未定义的额外命令、字段、机制不添加。
4. 第一轮完成必要 build/typecheck 与最小运行检查。每项非平凡逻辑至少留下一个可执行的最小检查，复用项目 vitest，不展开测试框架。lint 只做当前文件；全量测试与原任务验收留给第二轮。
5. 主 agent 在任务“结果”里记代码变化、实际检查和未测项，在“问题”里记录发现。功能已写但未完整验收标“已实现（待验收）”；无法实现的部分明确写缺口，不能以空函数或成功占位掩盖。保留已完成部分，不因其他缺口丢弃本轮实现。
6. 一个任务一个提交，由主 agent 统一更新状态表、CHANGELOG、锁文件和公共导出；第一轮保留在 `zoran/first-pass` 供 T14 后审核，不自动推 main、不打真实发布标签、不覆盖日用安装。
7. 第二轮才执行 `npm run build && npm run typecheck && npm test && npm run lint` 和全部验收，真实通过后将任务改为完成。T12 结果包含原始通过、失败、跳过数量。

## 路径与设计锁定

- 工序 0 由主 agent 作为设计方修改相关 spec、任务、decisions、index、AGENTS；提交后冻结。后续实现者只能更新任务结果/问题和本表状态。遇到新设计空白记录，留第二轮讨论。
- 各任务仍以自身“路径”为准。所有任务可更新自己的任务文档、总表状态及根 CHANGELOG。
- 新依赖只限任务已指定的库；T02 可改 sdk/package.json，T03/T05 可改 core/package.json，根 package-lock.json 由主 agent 更新。版本精确锁定。
- 测试默认与实现同目录，T02 另可用 sdk/test，T06 可用 core/test/fixtures，T12 可用 cli/test。不新建全局测试平台。
- 各包 src/index.ts 只准增加本任务真实实现所需的导出；T11 负责 core 的公共组装入口。跨任务接口由主 agent 协调，不重复定义 SDK 类型。
- T14 可改 README.md、README.zh-CN.md、根 package.json 的 repository；不增加独立安装器或 npm 发布流程。

**真实模型**：`openai/gpt-6-luna` 为默认且获准使用。测试凭据路径取 `YONDER_TEST_AUTH`，默认 `<仓库>/.yonder/auth.json`。只由受信任运行程序读取，不打印内容；OAuth 每个 home 独立登录，禁止复制其他程序的 OAuth。缺凭据记“未测：缺少凭据”，不伪装通过。

## 仓库布局（T01 建立）

```
packages/
  sdk/      @yonder/sdk    插件 API 类型、define* 辅助函数、testing/checkPlugin
  core/     @yonder/core   内核；src/runtime/ 是唯一 import pi 运行时的目录
  cli/      @yonder/cli    yonder 命令
plugins/
  channel-cli/             @yonder/plugin-channel-cli
  context-files/           @yonder/plugin-context-files
```

`@yonder/sdk` 只以 `import type` 重新导出 pi-ai 的 `Message`、`Models`、`Credential`，pi-durable 的 `ExecutionEnv` 与 typebox 的 `TSchema`（T02）；除此之外，pi 的包只出现在 `packages/core/src/runtime/`。插件只依赖 `@yonder/sdk`（04 §1）。

工具链（T01 已装）：Node ≥ 22.19、TypeScript 7（`tsc -b` 项目引用）、npm workspaces、vitest、Biome；`yaml` 由 T03 引入。

## 第一轮交接（到 T14）

**2026-10-18 审查补充**：主 agent 已亲自对照全部规范阅读生产源码与测试，修复了局部实现问题，未改冻结设计。完整的已修复项、尚未修复项、架构与插件清单、设计缺口、原始验证结果见 [第一轮源码审查](review-first-pass.md)。以下保留的是第一轮交接时的历史状态；离线 ENOENT 和单次工具流式缺口现已修复。T12 仍待做，不据此放行日用安装。

用户追加的全部要求已合并为 [下一阶段实施计划](next-mcp-self-maintenance.md) 与 [N00–N14 任务](next/README.md)，并于 2026-10-18 授权补齐审核缺口后启动。本轮功能写在 [10](../spec/10-local-maintenance.md)、[11](../spec/11-official-plugins.md)，由 N00 统一受影响旧条款并记录冻结 commit；覆盖真实安装、自维护、MCP、BrowserSkill、Computer Use、grep/Bash、hosted search/Tavily、GitHub 发布更新与飞书。此授权允许按依赖连续实施，原 T12 状态、失败与验收继续保留；新增插件尚未据此宣称实现。

- T02–T14 实现轮已结束；T12 保持待做，等待用户审核后再启动第二轮。全部包 build/typecheck 通过；未执行全量测试与全仓 lint。工序 0 之后冻结设计文档无变化。
- 真实最小闭环：CLI 初始化与启动 → 默认 openai/gpt-6-luna → bash/pwd → 回复 CLI → 在线会话/事件查询 → 停止；记录见 [T11](T11-cli.md)。开发 home 保留在被忽略的 `.yonder/home`。
- 已知可复现问题：停止后 CLI 离线查询的 readline/ENOENT 错误；真实对话只观察到 final，流式过程未验证。记录见 [T11](T11-cli.md)。
- 重点复核：运行上限、执行环境/附件组合见 [T05](T05-runtime.md)、[T08](T08-prompt.md)；steer 来源权限、投递与恢复组合见 [T09](T09-delivery.md)；正式安装、升级回滚与服务实际操作见 [T14](T14-release.md)。
- 用户追加品牌任务：可控登录名称提示、CLI 提示与两份 README 已统一 Yonder Harness；OAuth 授权页最终显示未重新登录核验。底层技术标识和版权归属未改名。

## 已批准：原生 pi TUI

2026-10-18 用户批准 spec/12 并要求开始实施、提供实际运行效果。任务见 [U00–U04](terminal/README.md)，主 agent 顺序执行，每任务独立提交；保留原 T/N 历史，不覆盖日用安装或擅自发布。
