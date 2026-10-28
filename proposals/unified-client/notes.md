# 实体笔记（给会话、联系人、模型挂备注）

状态：提案，待维护者批准。证据与方案对比见 [research/F1-notes.md](research/F1-notes.md)，记忆机制背景见 [research/G2-memory.md](research/G2-memory.md)。默认记忆、提示词与上下文的总体设计归 [agent-parity.md](agent-parity.md)。

## 1. 要解决什么

现有代码没有"给实体挂一段备注"的位置：`y_persons.note` 只能由配置或 CLI 写入，Agent 工具碰不到；`plugins/memory` 按时间线记账，没有实体主键。用户需要的是：进某个群聊时自动带上该群的规矩，进某个私聊时带上对这个人的备注，选模型时带上该模型的使用心得。

## 2. 决定的方案：memory 插件内新增实体笔记区（10-27）

- 存储：`entities/<type>/<id>.md`，frontmatter 带实体 ref（`conv:`、`acct:`、`person:`，第二步加 `model:<provider>/<id>`）。复用 memory 的存储、检索、隐私（`private/`、`allowedAgents`）和上下文贡献，不新开第二个存储。
- 工具：`memory_note`（`get`、`set`、`append`、`supersede`、`list`）。写入必须带 `source: evt:<id>`；用户口述的记 `by: owner`。写入只进 `log.md`，不进记录流。
- 注入：新增 `memory-entity` turn 贡献，只注入 `active` 笔记，`expired`、`private` 不注入。

| 触发 | 注入什么 | 预算 |
|---|---|---|
| 进入会话（`event.conv` 命中 `conv:` 实体） | 该会话的 active 笔记，最多 3 条 | ≤ 300 字符 |
| 首次出现某发送者（`event.from` 关联到 `acct:`/`person:`） | 该人的 active 笔记，最多 3 条 | ≤ 300 字符 |
| 选模型/查模型（第二步） | 该 `provider/model` 的笔记，最多 2 条 | ≤ 200 字符 |
| 显式 `memory_note get` | 全部 active 笔记 | 沿用 `memory_read` 的 12000 字符上限 |

## 3. 行为

- 同实体上限 5 条，带 `supersede` 语义；超限时工具报错，要求先用 `supersede` 合并。不自动合并（自动合并要模型推断）。
- 过期：`status: expired` 加可选 `expires`；`memory_status` 报告最久未更新的笔记。
- 删除：物理删除对应段落，`log.md` 只留一行不含正文的删除记录。
- 查看与编辑：`yonder memory note <entity>`、渠道卡片上的"备注"按钮、直接改 Markdown（Obsidian 可打开）。
- 不给 `ProviderConfigSchema` 加 `note` 当存储：`yonder.yaml` 是管理员配置，改完要重启，Agent 工具碰不到。

## 4. 分两步

1. 不碰 SDK：实体笔记区、`memory_note`、`memory-entity` 贡献，键覆盖 `conv`/`acct`/`person`。
2. 已批准的 SDK 变更：`RenderContext`（`packages/sdk/src/types.ts:330-337`）加 `model?: {provider, id}`，使换模型时自动注入模型备注。此前模型备注只能写入，经 `memory_note get model:<p>/<m>` 读取。

## 5. 需要的设计变更

实施归 A 线，排在 [agent-parity.md](agent-parity.md) P4 之后。D41 的"不自动注入"被部分替代。先改 `docs/spec/15-memory.md`（新增"实体笔记"一节），在 `docs/decisions.md` 记一条并替换 D41 中"不自动注入"的表述，再动代码。第二步另改 spec 04 的 `RenderContext`。

## 6. 决定记录

- 10-27：采用方案 A（memory 插件内的实体笔记区），新增 `memory_note` 工具。
- 10-27：批准第二步，给 `RenderContext` 加 `model?: {provider, id}`。
