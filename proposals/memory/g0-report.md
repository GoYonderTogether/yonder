# G0 调研与事实核对报告

日期：2026-10-22。本轮结论：**G0 未通过，暂停；不进入 WP1。** 第 1 项发现 SDK 不提供按事件 id 精确查询的接口，按 runbook 的“不符的立即停下汇报”停止后续调研。这里报告的是接口事实及规范依赖的缺口，不认定内核违反事件查询规范：事件规范本身也没有 id 筛选字段。[依据：`proposals/memory/codex-runbook.md:20–31`；`docs/spec/01-events.md:92–109`]

## 1. 范围与工作区

- 本轮唯一写入文件：`proposals/memory/g0-report.md`；不编码、不提交、不切分支、不进入 WP1、不访问 Obsidian。用户本轮明确限定只能写这个报告，所以问题记在这里，没有另写 `open-questions.md`，也没有执行会写入构建产物或临时文件的检查。[依据：本轮用户 `<task>`、`<action_safety>`；runbook 第 13、16、22 行]
- 观察到当前分支为 `zoran/memory-spec`，HEAD 为 `2e5949e8a1043c0b5bbacad1c5dd25b718679a5e`。[命令：`git branch --show-current`、`git rev-parse HEAD`]
- 初始 `git status --short --untracked-files=normal` 输出如下；仅观察路径状态，没有读取或修改这些文件内容：

  ```text
   M proposals/ai-card/architecture.md
   M proposals/ai-card/foundation.md
   M proposals/ai-card/pages.md
  ```

- `codegraph status .` 返回 `Not initialized`；未初始化索引，改用实时源码核对。[依据：该命令输出；本轮只写报告的边界]

## 2. G0 逐项核对

“已核实”仅指下列静态类型、源码或命令输出；不等于实际渠道、模型或用户资料验收。

| 项目 | 状态 | 观察证据与未核实部分 |
|---|---|---|
| 1a. `message.in` 发送者 | 已核实（类型及规范）；运行未测 | `events.on` 的 handler 接收 `YEvent`，其中 `from?: Ref`、`ts: string`、`id: string`；`Ref` 实际只是 string，不能把类型本身说成保证了 `acct:`。事件规范规定 `message.in.from` 为 `acct:` 发送者。未跑实际渠道接收链。依据：`packages/sdk/src/types.ts:6–18,388–392`；`docs/spec/01-events.md:45–47`。 |
| 1b. acct → person | 已核实（接口）；运行未测 | `identity.account(ref)` 返回可缺省的 `AccountInfo`，其 `person?: Ref`；插件实现转发至 `services.identity.account(ref)`。因此接口允许读取已关联 person，但未关联账号不能据此认定 owner。未读取真实身份库。依据：`packages/sdk/src/types.ts:212–224`；`packages/core/src/plugins/index.ts:240–242`。 |
| 1c. 按 id 取得确认事件及 `from`、`ts` | **与 G0 所需能力不符，停止点** | `EventQuery` 无 `id`；内核 query 无 id 等值筛选，`after` 是 `id > ?`，会排除指定 id。内核内部有 `get(id)`，但未暴露到插件 events API。查询返回的 `YEvent` 有 `from`、`ts`，缺口在定位目标事件。详见 §3。 |
| 2. turn/system 上下文 event | 未能核实完整行为 | 已读类型：`ContextContribution.placement` 为 system/turn，二者共用 `RenderContext`，其中 `event?: YEvent`，`event.from` 若存在即 Ref string。仅靠类型不能证明 system 一定拿不到 event；触发停止条件后未追上下文组装实现。依据：`packages/sdk/src/types.ts:320–332,6–18`。 |
| 3. Trigger、data、skills | 部分已核实；其余未能核实 | 类型存在 `start(io: { emit(e: EventInput): Promise<YEvent> })`、`stop()`、`api.paths.data: string`、`api.skills.register(dir: string)`；事件规范写明 `conv:<triggerId>:<name>`。data 的实际路径构造、skill 目录解析约定及真实注册未继续核对。依据：`packages/sdk/src/types.ts:334–337,387,422`；`docs/spec/01-events.md:41`。 |
| 4. cron payload 与绑定唤醒 | 未能核实 | 已读 `docs/spec/14-execution-capabilities.md` §2，其要求原始事件沿绑定唤醒；未核对 `plugins/cron` 的实际 payload、绑定匹配与主人配置档运行链。停止后不以规范代替实现证据。 |
| 5. rg 可用性与核心定位方式 | 部分已核实 | 本轮多次 `rg -n`、`rg --files` 成功返回源码结果，证明当前工具命令环境能执行 rg，未测服务进程 PATH。核心 grep 直接构造以 `"rg"` 为首项的 argv，调用 `ctx.env.exec`；没有在该实现中指定绝对路径，spawn_error 转为 rg 不可用诊断。依据：本轮 rg 命令输出；`packages/core/src/runtime/grep.ts:34–49,93–99`。 |
| 6. markitdown/docling 转换评估 | 未能核实／未测 | 停止后未查外部来源、版本、安装方式及许可证；未安装转换器，未读取或转换真实 PDF/docx，不给推荐。runbook 中的 MIT 字样尚未独立核实。依据：runbook 第 29 行及本轮执行记录。 |
| 7. 中文字面检索与行号 | 未测 | 没有创建中文临时文件，也没有执行此专项验证。停止条件已触发；本轮还明确禁止写报告以外的路径，不能把已有源码搜索算作临时文件验收。依据：runbook 第 30 行、本轮 action_safety 及执行记录。 |
| 8. Obsidian 只读扫描 | 未测，等待用户提供并确认路径 | 未访问任何 Obsidian 目录；没有采集文件内容、字节或 mtime，不能声称只读扫描通过。若后续获准补做，先向用户询问库路径，不能使用历史记忆中的路径。依据：runbook 第 31 行、本轮用户约束及执行记录。 |

## 3. 不符与待维护者决定事项

### G0-1：确认事件查询能力缺口

要求与实际证据：

1. runbook 第 24 行要求核对 `events.query` 能否“按 id 取单个事件”；`docs/spec/15-memory.md` §5 要求通过 `events.query` 与 identity 核验 `confirmEvent` 的 owner 和写入时间先后。
2. `packages/sdk/src/types.ts:92–101` 的查询字段只有 `type/from/conv/agent/since/until/after/limit`；第 388–392 行的插件事件 API 只有 `emit/ask/query/on`。
3. `packages/core/src/plugins/index.ts:170` 将 query 直接转发到 `services.events.query(query)`。
4. `packages/core/src/store/index.ts:247–275` 实际 query 只实现上述筛选；第 266 行为 `if (query.after) add("id > ?", query.after)`。所以 `after: confirmEvent` 不是取得该事件的办法；强塞未声明的 `id` 也不会在该函数中形成 id 等值筛选。
5. `packages/core/src/store/index.ts:243–246` 内部确有 `get(id)` 和 `SELECT * FROM y_events WHERE id = ?`，但插件 API 没有暴露它。插件也不能通过 import core 绕过边界。[另见 runbook 第 13–14 行]

**影响：** 当前没有插件可直接调用的按 id 精确查事件能力；影响 WP5 的确认事件核验。不能由此推断“任何插件内方案都不可能”：通过现有分页查询逐页查找 id 是待讨论的可能方向，但本轮未设计、实现或验证，不能当作已解决。

**待决定：** 是否允许插件用现有分页接口遍历并精确匹配目标 id，还是由维护者另行批准接口／规范调整。runbook 禁止本任务自行修改 SDK、内核及规范，因此本轮不作选定、不补实现。[依据：runbook 第 13 行；`AGENTS.md` 第 3、7 条]

## 4. 实际验证与原始结果

- 已验证：SDK 类型、插件 API 转发、存储查询源码中缺少 id 精确筛选；当前分支及 HEAD；当前命令环境 rg 可执行。均为 §1–3 列出的源码及命令证据。
- 仅实现未验证：无；本轮没有实现插件或代码。
- 自动化测试原始计数：**无输出、未执行**，不记成 0 失败或通过。`npm run build`、`npm run typecheck`、`npm test`、`npm run lint`、`checkPlugin`、真实模型验收均未执行；本轮为 G0，中途按停止规则结束，非工作包实现交付。[依据：runbook 第 18、22、33–46 行；本轮用户边界]
- 调研命令异常保留：一次 `rg -n ... packages/core/src/events` 返回路径不存在的 IO error（退出码 2）；随后通过 `rg --files packages/core/src` 定位到实际 `packages/core/src/store/index.ts` 并完成该缺口的源码核对。`codegraph status .` 退出码 0 但报告未初始化，不算索引可用。首批大段读取输出有截断，关键 runbook、架构、SDK 与查询实现随后单独读取；未取得的部分没有标作已核实。
- 转换、中文临时文件检索、真实 Obsidian 扫描及实际运行的未测项见 §2；没有测试失败被后续成功覆盖。

## 5. 下一步

**WP1 不能自动开始。** 本轮到报告为止，等待用户确认；G0 仍有查询缺口与未完成核对项。即使 WP1 本身尚不使用 `confirmEvent`，也不能据此跳过 runbook 的 G0 停止规则。后续若继续 G0，应先解决 §3 的维护者决定，再按授权补齐未核实项；涉及真实 Obsidian 时先询问并等待路径确认。[依据：runbook 第 22、31 行；本轮用户“汇报后等我确认再进入 WP1”]
