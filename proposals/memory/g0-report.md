# G0 调研与事实核对报告

日期：2026-10-22；基线：`d388937`，分支 `zoran/memory-spec`。

**结论：第 1–5、7 项与修订后的规范无硬性冲突；第 6 项（文档转换器）未完成；第 8 项（Obsidian）按要求未做。WP1 等待维护者确认，不自动开始。** 发现 1 处文档缺项、3 处规范空白（见文末），其中转换器调用协议已由规划方补进规范，其余两处已在规范中澄清。

> 本文由 Codex 的核对稿合并而成：第 1–5、7 项为其源码核对与实测；第 6 项因网络下载过慢未能完成，状态见 §6。Codex 会话在第 6 项下载途中结束，没有给出该项结论。

## 范围、证据等级与历史结果

- 仓库只更新本报告；实验依赖、缓存、公开样本、脚本和输出均以 `/tmp/yonder-memory-g0.AwzTjf` 为目标目录。不改代码、规范、配置或索引，不做 Git 暂存／提交／分支操作；不安装到全局，不访问 Obsidian，不读取模型凭据，不运行 Harness 服务或对话模型。[依据：本轮用户 task/action_safety；下列实际命令]
- 初始 `git status --short` 仅列出 `proposals/ai-card/{architecture,foundation,pages}.md` 三处修改；没有读取或修改这三份文件内容。报告不提交，不 push/tag/merge。[依据：本轮 git status 输出和操作记录]
- 第 1–5 项以**当前源码及类型**核实，不冒充实际消息、真实模型或生产服务验收；第 6、7 项的实际运行证据另列。源码位置均对应上述 HEAD。
- 前轮基线 `2e5949e8a1043c0b5bbacad1c5dd25b718679a5e`：发现 `EventQuery` 无 id 筛选，依旧 runbook 立即暂停，转换与中文实验均未测。此次修订已去掉该依赖，旧缺口不再作为本轮阻塞。[依据：本报告前版；`git show d388937` 对应修订；当前 spec 15 第 114–115 行、runbook 第 22–30 行]

## 1. SDK、steer 合并与监听时序

**结论：符合现有接口事实；确认规则必须按“运行第一条来源事件”理解。合并输入的产品语义有待明确，不能宣称 `event` 是最新确认消息。**

### 发送者与 owner 映射

- `YEvent` 有 `id`、`ts`、可选 `from`；`Ref` 的实际类型为 string。`events.on` 的 handler 收到 `YEvent`。消息发送者在顶层 `event.from`，不在 data。事件规范规定 `message.in.from` 为 `acct:`；渠道入口实际检查账号与 conv 属于该渠道实例。[`packages/sdk/src/types.ts:6–18,388–392`；`docs/spec/01-events.md:45–47`；`packages/core/src/plugins/index.ts:67–77`]
- `api.identity.account(acct)` 返回 `AccountInfo | undefined`，其中 `person?: Ref`；插件 API 转发到内核身份服务，实际查询 `y_accounts.ref`。插件需比较 `account?.person === config.owner`；账号存在不等于已关联 owner。[`packages/sdk/src/types.ts:212–224`；`packages/core/src/plugins/index.ts:240–242`；`packages/core/src/store/index.ts:329–350`]
- 事件落库时更新账号 firstSeen/lastSeen/name，账号关联仍保留；事务结束后才通知观察者。[`packages/core/src/store/index.ts:72–95,125–130`]

### steer 时 `ToolContext.event` 指哪条

源码链路：

1. runtime 设置 `steeringMode: "all"`。[`packages/core/src/runtime/index.ts:128–139`]
2. durable 将选中的 steer 按队列顺序放置，并把 submission id 追加到当前 `live.run.inputs` 尾部；不是替换首输入。reset 导致开新 run 是另一分支。[`packages/pi-durable/src/harness/inbox.ts:81–110`；`packages/pi-durable/src/harness/generation.ts:586–595`，另见 `:296,722`]
3. runtime 的 `sources(ids)` 按输入数组顺序恢复来源事件；`context()` 取 `const input = events[0]`，将它赋给 `event`，同时提供完整 `events`。[`packages/core/src/runtime/index.ts:160–175,929–955`；SDK 对 `events` 注释见 `packages/sdk/src/types.ts:303–312`]
4. 工具开始时保存 config/events 快照，工具执行中沿该快照构建上下文；之后才到达的 steer 不会回写已开始工具的来源快照。[`packages/core/src/runtime/background.ts:228–237`；`packages/core/src/runtime/index.ts:231–247,356–370`]

**由源码推导的边界，未做真实模型重放：**

| 同一 run 的已放置来源顺序 | `ToolContext.event` | 按修订 §5 的机械核验结果 |
|---|---|---|
| owner A，随后 owner B steer | A | 确认证据仍是 A；提议若写在 A 之后，B 不能通过该字段确认它 |
| cron C，随后 owner B steer | C | 当前 run 的 commit/confirm 仍应被拒；不能把 B 当作 `event` |
| owner A，随后 cron C 或其他发送者 steer | A | `event` 的来源检查仍取 A；不能据最新输入判断 run 来源已变为 cron/其他人 |

这不证明实现违反修订规范：spec 15 §5 现在直接以 `ToolContext.event` 定义前置条件，按首事件执行可以一致。它也不支持“最新一条 owner 消息就是确认依据”或“只要收到 cron 输入就必定拒绝确认”的额外承诺。维护者需确认上述合并语义是否就是期望；本轮不改选取规则。[`docs/spec/15-memory.md:114–115`；上述源码]

### `events.on` 与启动的先后

- 绑定解析、session 选择及 routes 构造先完成；然后 `await store.events.append(event)`；之后 `void dispatch(stored, runs)`，dispatch 最终调用 `runtime().submit`。[`packages/core/src/routing/index.ts:249–308,144–182`]
- append 在事务后调用 `onEvent`；kernel 回调以 **`void plugins?.observe(event)`** 启动监听，不 await。[`packages/core/src/store/index.ts:125–130`；`packages/core/src/kernel/index.ts:87–104`]
- observe 用每插件 Promise 链串行调用 handler，传入 `structuredClone(event)`，异常只记日志。[`packages/core/src/plugins/index.ts:367–393`；契约 `docs/spec/04-plugins.md:197`]

**有保证的是**：落库及路由决策完成后调度观察；同一插件观察串行、不能改原事件。**没有保证的是**：handler 开始或完成一定先于该输入的运行启动／工具调用。先前观察若未完成，当前 handler 甚至可能尚未进入；采集文件不能假定已写完。这与只读观察契约一致；spec 15 §6.1 的 `{chat}` 采集与 §5 的记录 evidence 不能擅自解释成同步前置屏障。[上述源码；`docs/spec/01-events.md:131`；`docs/spec/15-memory.md:115,122`]

## 2. ContextContribution

**结论：符合；system 无 event 属实，turn 的 event 是逐条输入事件。**

- SDK 的 `RenderContext.event?: YEvent` 并不在类型层区分 placement。[`packages/sdk/src/types.ts:320–332`]
- 真正 system 调用为 `contributions(session, "system", options)`，没有传 event；`renderContext` 只在参数有值时添加 event。[`packages/core/src/prompt/index.ts:46–85,102–112`]
- `prepareInput` 每处理一条事件，就以 `preparedEvent` 调 turn 贡献；保留原来的 `from`，仅对消息的附件字段更新。因此 `message.in` 的 `event.from` 是 `acct:<实例>:<账号>`，cron 来源是 `plugin:cron`，并不是 person；owner 要查 identity。steer 输入同样逐条准备，不能把 turn 贡献的 event 等同于工具的首输入 event。[`packages/core/src/prompt/index.ts:211–227`；`packages/core/src/runtime/index.ts:609–627`；`plugins/cron/src/index.ts:318–323`]
- 未进行真实模型上下文验收；上述为实际调用源码核实。

## 3. Trigger、data 与 skills

**结论：符合；无须新增 SDK 接口。**

- Trigger 实际为 `start(io: { emit(e: EventInput): Promise<YEvent> }): Promise<void>` 与 `stop(): Promise<void>`；加载器在启动阶段提供包装后的 emit，检查事件 type 以插件 id 开头。[`packages/sdk/src/types.ts:334–337`；`packages/core/src/plugins/index.ts:67–77,355–357`]
- `conv:<triggerId>:<name>` 是事件规范约定，包装器不会自动补 conv，插件自己填写。memory-inbox 对应 `conv:memory-inbox:default`。[`docs/spec/01-events.md:41`；`docs/spec/04-plugins.md:125–131`；`docs/spec/15-memory.md` §6.3；上述包装源码]
- `api.paths.data = join(home, ".yonder", "plugins", manifest.id)`。它不是 root，也不是 agent workspace；该赋值本身不创建目录。[`packages/core/src/plugins/index.ts:260`；`docs/spec/04-plugins.md:192`]
- `api.skills.register(dir)` 注册插件包内的 skill 容器目录；含 `SKILL.md` 的子目录提供 skill。相对路径从插件包目录 resolve；SDK 检查 realpath 不得越包，递归检查 name/description 并与 `contributes.skills` 比对；内核发现时也递归扫描。[`docs/spec/04-plugins.md:160–162`；`packages/core/src/plugins/index.ts:268–269,290–295`；`packages/sdk/src/testing.ts:123–168`；`packages/core/src/skills/index.ts:86–97,159–165`]
- setup 只注册；目录创建、监听或安装不能移入 setup。既有 context-files 仅注册 system 贡献，wechat-archive 通过 Trigger start 启动采集，可沿用职责边界。[`docs/spec/04-plugins.md:206–213`；`plugins/context-files/src/index.ts:12–31`；`plugins/wechat-archive/src/index.ts:38–43`]
- 未创建 memory 包，未运行其 checkPlugin；不能把这些接口核对当成 WP1 验收。

## 4. cron payload 与主人配置档唤醒

**结论：源码能力符合；README 的 payload 速记省略了必填 kind，不能直接作为创建参数。**

实际 job payload 类型是：

```ts
{ kind: "event", type: string, target: string, data: Record<string, unknown> }
```

- schema 四字段均必填，event type 要在 `cron.*` 下，target 必须为 `conv:`，创建者需要 admin。[`plugins/cron/src/index.ts:18–22,74–81,185–194`]
- 发出的实际事件为 `{ type: payload.type, from: "plugin:cron", conv: payload.target, data: { ...payload.data, target: payload.target, cron: { job: job.id, run: run.id } } }`；经 `api.events.ask(event)` 等待绑定命中的结果。`target` 和 `cron` 会覆盖同名用户 data 字段。[`plugins/cron/src/index.ts:316–340`]
- spec 15 §9 的 skill 名可放在自定义 data 中，输入准备会把插件事件 data 完整 JSON 呈现；内核没有自动执行 `data.skill` 的专用分支，最终仍由模型按指令使用选中的 skill。[`docs/spec/15-memory.md` §9；`docs/spec/01-events.md:24`；`packages/core/src/prompt/index.ts:213–220`]
- 应由 agent 绑定的 type/conv 匹配，profile 选择主人类配置档，wake 为 run（或缺省 run）；owner 对应的配置档必须已选择 memory 工具/上下文/skills。不是 cron 自动按 owner 找 agent。[`packages/core/src/routing/index.ts:34–55,249–292`；`docs/architecture.md` §5 不变量 2–3]
- `match.from: owner` 不适用于 cron：此匹配先要求来源是 acct，而 cron 是 plugin:cron。绑定需按 cron 事件类型及 conv 匹配；不增加新的 owner 匹配语义。[`packages/core/src/routing/index.ts:43–54`]
- `plugins/cron/README.md:7` 的 `event {type,target,data}` 是速记，漏写 schema 必填 `kind: "event"`；后续 README 示例应展示真实形状。memory spec 未硬编码错误形状，因此不据此认定 spec 15 与实现冲突。
- 未创建真实 cron 作业、未唤醒模型；本项为调用链核实。

## 5. rg 依赖和定位

**结论：符合；复用执行环境的 PATH 中的 rg，不引入另一个 locator 或检索实现。**

- `command -v rg` 输出 `/Users/zoran/.local/share/mise/installs/node/24.21.0/lib/node_modules/@openai/codex/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/codex-path/rg`；`rg --version` 为 `ripgrep 15.2.0 (rev e89fff89ac)`。这是本次命令环境的事实，不证明后台 Yonder 服务的 PATH 相同。
- 核心 grep 构造 argv `rg --json --no-follow ... -- pattern path`，literal/ignoreCase 时加 `--fixed-strings/--ignore-case`，直接 `ctx.env.exec(argv, ...)`，没有 shell、固定绝对路径或自动下载。spawn_error 给出 rg 不可用诊断；退出码 1 与 >1 分别处理。[`packages/core/src/runtime/grep.ts:34–49,93–100`]
- local 执行环境是已有 `NodeExecutionEnv({cwd})`。[`packages/core/src/runtime/env.ts:1–11`]
- memory 根目录在主机，照 spec 15 §6.2 使用主机进程可找到的同一 rg 命令；不能把上述 Codex 私有安装路径写成产品配置默认。生产服务环境未测，应由 memory_status 实测诊断，不宣称已就绪。[`docs/spec/15-memory.md:131`；该规范 §1]

## 6. 文档转换器评估（markitdown / docling）

**结论（2026-10-22 下午由规划方补测）：两者都能转换；推荐 markitdown 作默认 converter，docling 仅作需要 OCR/复杂版式时的可选项。** 下文“安装”一段记录的是 Codex 当时受沙箱网络限制的失败，补测在本机直连网络下完成。

补测结果（隔离虚拟环境，样本为同一份 1 页 PDF 与 docx，以及自生成的中文 docx/PDF）：

| | markitdown 0.1.9（`[pdf,docx]`） | docling（最新版，`--pipeline` 默认） |
|---|---|---|
| 安装 | 约 21 秒，体积小 | 约 1.4 GB 虚拟环境，另在 `~/.cache/huggingface` 下载模型 |
| PDF（1 页） | 0.33 秒，退出码 0，Markdown 到标准输出 | 首次 46 秒（含模型下载），写入输出目录 |
| docx | 0.23 秒，正文干净 | 96 秒（含首次初始化），输出 139 KB（体积异常大，疑含内嵌图片数据） |
| 中文 docx | 正确 | 未测 |
| 中文 PDF | 文字正确，但“文”被抽成康熙部首“⽂”（U+2F42） | 未测 |
| 调用方式 | `markitdown <文件>` 标准输出 | `docling --to md --output <目录> <文件>`，需包装才能走标准输出 |

**新发现**：PDF 抽取会把汉字映射成兼容字符，直接落盘会让中文子串检索失败；NFKC 规范化可以修复（已写入规范 §6.1、§6.2）。注意 NFKC 同时会把全角冒号等标点变成 ASCII，所以只对转换产物规范化，检索词则原样与规范化各搜一次。

未测：扫描件/OCR、复杂版式、大文件、docling 的中文表现；docling 补测会在用户 `~/.cache/huggingface` 留下模型缓存。

以下为 Codex 当时的原始记录：

- 许可证：两者的 GitHub 仓库许可均为 MIT（Codex 查询公开 API；规划方另用 `gh repo view` 复核，markitdown 191k 星、docling 69k 星，2026-10 仍在更新）。
- 样本：`/tmp/yonder-memory-g0.AwzTjf/test.pdf`（1 页，93 KB）与 `test.docx`（136 KB）为下载的公开样本，已用 `file` 核验类型；docx 正文包含公开论文内容。
- 安装：两个工具在隔离虚拟环境中先后用 `uv` 与 `pip` 安装，均因下载过慢（观察到约 25 kB/s）超时或被中断；`markitdown-pip.log` 停在 onnxruntime 20.9 MB 的下载，`docling-pip.log` 停在 docling_core。规划方随后另用 `pip install "markitdown[pdf,docx]"` 在全新隔离环境重试，150 秒超时失败。**没有任何一次转换被运行**，因此既没有输出文本，也没有耗时与准确性数据。
- 可观察到的差异（来自下载日志，非实测）：docling 的依赖明显更多更重（含 accelerate 等），markitdown 较轻。
- 接口（来自两者 README，未在本机运行验证）：markitdown CLI 默认把 Markdown 写到标准输出；docling CLI 写入输出目录。这决定了与 spec 15 的衔接方式，见文末“空白 3”。
- 隔离目录 `/tmp/yonder-memory-g0.AwzTjf`（约 84 MB，含未完成的下载缓存与两个空虚拟环境）保留，等待维护者决定是否重试或清除。

## 7. 中文真实检索

**结论：符合；4 通过 / 0 失败 / 0 跳过。**

文件 `/tmp/yonder-memory-g0.AwzTjf/chinese.txt` 为实际 UTF-8 文件，5 行依次为：

```text
记忆：周回顾
主人确认计划
中文子串：长期记忆与检索
CaseMix 中文检索
字面量：计划[甲].*
```

直接运行 argv `['rg', '--fixed-strings', '--ignore-case', '--line-number', '--', term, path]`，无 shell；四次退出码均为 0、stderr 均空，逐字检查 stdout：

| term | stdout |
|---|---|
| `记忆` | `1:记忆：周回顾` 与 `3:中文子串：长期记忆与检索` |
| `中文检索` | `4:CaseMix 中文检索` |
| `casemix` | `4:CaseMix 中文检索` |
| `计划[甲].*` | `5:字面量：计划[甲].*` |

可重放：`python3 /tmp/yonder-memory-g0.AwzTjf/chinese-search.py`；原始结果 `/tmp/yonder-memory-g0.AwzTjf/chinese-search.json`，输出末行 `PASS=4 FAIL=0 SKIP=0`。这证明本机本命令环境的中文子串、行号、大小写忽略与固定字面量行为，不证明尚未实现的 memory_search 排序/过滤/权限。[依据：实际命令输出及结果 JSON；目标为 spec 15 §6.2]

## 全部不符项、规范空白与待确认边界

### 已证实的不符／文档缺项

1. **cron README payload 速记不完整**：runbook G0-4 要求依 cron 文档核对实际形状；`plugins/cron/README.md:7` 的 `{type,target,data}` 未展示 schema 必填的 `kind: "event"`。实际 schema 在 `plugins/cron/src/index.ts:74–81`。它可以被理解为分类速记，不能当作完整可提交 JSON。本轮仅报告，不改 README。spec 15 §9 只引用 cron 文档，未规定这个缺失字段的对象，因此不能扩大为“memory spec 的事件结构错误”。
2. **旧的事件 id 查询阻塞已经消除**：d388937 的 spec 15 §5 不再依赖 id 查询。实际 SDK 仍无 id 精确筛选；不是新发现的不符，也不再据此中断。[`packages/sdk/src/types.ts:92–101,388–392`；`docs/spec/15-memory.md:114`]

除上述文档形状缺项，本轮未证实第 1–5、7 项与修订后 spec/runbook 的硬性冲突。第 6 项的安装或转换失败如有发生，属于实验失败，不自动等于规范错误；详细结果见 §6。

### 规范空白（规划方已处理，待维护者复核）

1. **首输入与确认边界**：`ToolContext.event` 固定为运行的第一条来源事件。规范 §5 已写明按此执行，多条输入合并时后到的消息不能确认更早的提议，确认应在新一轮进行；未改动任何选取规则。
2. **采集完成与 evidence 时序**：`events.on` 不保证先于运行启动。规范 §5 已写明：运行刚开始时 `{chat}` 记录可能未写入，只能用“当前运行由 owner 消息触发”作证据，不得伪造。
3. **converter 调用协议**：规范原先只给了命令路径。规范 §10 已补：不经 shell，`[command, ...args, 输入绝对路径]`，退出码 0 且 stdout 非空为成功，stdout 即 Markdown，超时算失败。这与 markitdown CLI 的默认行为吻合（未在本机运行验证）；docling 需用户自备输出到 stdout 的包装脚本。

## 验证范围与下一步

- 已验证：第 1–5 项的类型和源码链路、第 7 项的实际文件与命令行为；转换实验单独按 §6 的原始记录判定。
- 仅实现未验证：无；没有写插件或其他产品代码。
- `npm run build`、`npm run typecheck`、`npm test`、`npm run lint`、memory 的 `checkPlugin`、真实模型与实际渠道验收均**未执行**；没有相应原始测试计数，不能写成全套通过。原因是本轮仅 G0 且禁止写构建输出和进入实现，不是“缺凭据”。[本轮用户边界；runbook 第 18 行是工作包结束要求]
- 第 8 项：**未测，按用户要求不执行**。未访问 Obsidian；没有库路径、内容、字节及 mtime 证据。后续若需要，先询问并等待用户确认路径。[runbook 第 31 行及本轮用户约束]
- 调研异常没有抹去：两轮源码定位中对不存在路径的 rg 曾输出 IO error，随后用 `rg --files packages/core/src` 定位到实际 store/prompt/kernel 文件；前轮 CodeGraph 未初始化，未创建索引。本轮网页工具打开 GitHub API 文件列表失败后，改用进程网络包装的 curl 成功取得公开列表；没有把网页失败算作样本下载成功。安装失败、取消及成功均分别保留在 §6。
- **汇报后停止，等待用户确认。没有进入 WP1，也没有给出 WP1 已验收结论。** 第 6 项若尚有未测，不能将 G0 写成全项通过；上述边界与规范空白由维护者裁决后再安排后续工作。
