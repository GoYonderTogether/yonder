> 证据材料，结论已并入 [agent-parity.md](../agent-parity.md) 与 [notes.md](../notes.md)

# Yonder 默认记忆插件调研：Hermes 记忆/技能机制、pi 生态方案与本机现状

## 0 结论摘要

1. Hermes 的「记忆」其实只有两件事：两个**硬字符上限**的 Markdown 文件（`MEMORY.md` 2200 字符、`USER.md` 1375 字符，`hermes_cli/config_defaults.py:1313-1322`），加上一个**无上限**的 SQLite FTS5 会话库（session search）。「技能」才是它装经验的主容器，记忆被官方提示词明确定义为「每会话都用得上的窄例外」（`agent/prompt_builder.py:195-236`）。
2. Hermes 已知的失败模式在 issue 里被量化过：152 个技能里 22 个零使用近重复、用户手工删 17 个（#67582）；`write_approval` 下 8.4 天攒 357 条零批准技能提议、21% 因锚点失效永久作废（#75130）；长期记忆**完全没有周期维护**，只有一道硬上限（#90035）。根因是「agent 同时是作者、执行者、质检者」，以及「维护机制默认关闭或不存在」。
3. 三个 pi 插件里只有 `pi-hermes-memory`（MIT，0.9.11）真的照搬了 Hermes 语义，并且**修掉了 Hermes 的两个坑**：默认 policy-only（不整篇注入）、写入走 `memory_add/replace/remove` 而不是整条覆盖、技能创建带同名+描述相似度拦截、容量满时自动 consolidation。
4. Yonder 已经有两套记忆，互不相通：`plugins/memory`（person 级、按时间线记账、9 个 `memory_*` 工具、无淘汰机制）与 `plugins/hermes-experience`（agent 级 `MEMORY.md`/`USER.md`、Hermes 2200/1375 上限、每 10 turn 后台复盘、私有 `hermes-learned-*` 技能）。
5. 本机实测：「自由生长」**在 `MEMORY.md`/技能上还没发生**（`agents/hermes/memories/MEMORY.md` 与 `USER.md` 都是 0 字节；全机只有 1 个学习技能），但**在日志式记忆上已经发生**：`~/Memory` 有 838 条记录、681 条未整理（81%）、403 条（48%）是无正文的图片占位记录，单个周文档已 69KB。
6. 建议：不新开第三个插件，把「日志记忆 + 用户画像 + 实体笔记 + 经验技能」收进 `plugins/memory` 一个存储与一个工具面，按 `proposals/unified-client/research/F1-notes.md` 的主 Agent 裁定走方案 A，并把 `hermes-experience` 的记忆/技能部分**降级为它的写入后端**而不是并列第二套。

---

## 1 Hermes Agent 的记忆与技能设计

### 1.1 两个文件的容量与形状

- 位置：`~/.hermes/memories/MEMORY.md`（agent 自记：环境事实、约定、学到的东西）与 `USER.md`（用户画像：偏好、沟通风格）。
- 上限：`memory_char_limit: 2200`（注释 `~800 tokens at 2.75 chars/token`）、`user_char_limit: 1375`（`~500 tokens`），见 `hermes_cli/config_defaults.py:1313-1322`。
- 注入形状：会话开始时渲染成**冻结快照**，首行带用量，如 `MEMORY (your personal notes) [67% — 1,474/2,200 chars]`；条目之间用 `§` 分隔，条目可多行。快照在会话内**不刷新**（保 prefix cache），实时状态只能靠工具返回。
- 工具只有一个 `memory`，三个动作 `add` / `patch`（`old_text` 是条目内唯一子串）/ `remove`（子串）。**没有 `read`**（内容已在 system prompt），**没有 `replace`**——整条覆盖会把多事实条目抹掉，现已改为报错并指向 `patch`。
- 容量满时**不自动压缩**，直接报错并回传 `current_entries`/`usage`：

```
Memory at 2,100/2,200 chars; adding this entry (250 chars) would exceed the limit by 153 chars.
Retry as ONE 'operations' batch that removes or shortens (patch) stale entries ... 
```

- 去重只做完全相同的条目（返回 success + "no duplicate added"）；写入前扫注入/外泄模式与隐形 Unicode，命中即拒（因为这些内容会进 system prompt）。

### 1.2 写入时机

- 模型自决 + 硬提示词约束。记忆引导原文（`agent/prompt_builder.py:195-236`）：

> "Skills come first: when you learn something while doing a task … record it in the skill you used or built for the task (skill_manage), where it loads only when relevant." … "Memory is the narrow exception for facts that apply to EVERY session regardless of task … Write entries as declarative facts, not instructions to yourself: 'User prefers concise responses' ✓ — 'Always respond concisely' ✗ … A fact stale within a week belongs in session history; procedures and workflows belong in skills."

- 周期触发：`memory.nudge_interval: 10`（`config_defaults.py:1321`），即每 10 轮提示一次复盘；技能侧另有 `skills.creation_nudge_interval` 默认 15。
- 后台复盘（background review）：每个 turn 结束后 fork 一个无身份 agent 问「该不该存」，写入直落 store，不碰主对话与 prompt cache；可用 `auxiliary.background_review.{provider,model}` 换便宜模型，换模型时重放 compact digest 而非全文。
- 审批门：`memory.write_approval: true` 时，交互 CLI 前台内联提示，其他面（消息平台、脚本、后台复盘）一律 stage 到 `~/.hermes/pending/`，`/memory approve` 会打印被覆盖条目的全文；staged 的 patch/remove 记录目标条目，条目变了则拒绝执行。

### 1.3 session search

- 所有 CLI/消息会话进 `~/.hermes/state.db`（SQLite + FTS5），`session_search` 返回**真实消息**（不摘要、不截断），可前后滚动；实测 ~20ms 查询 / ~1ms 滚动。
- 这是 Hermes 的成本设计核心：常驻记忆只占 ~1,300 token，历史一律「按需检索、零常驻」。

### 1.4 技能自动生成与 Curator

- 存储：`~/.hermes/skills/` 单一真源，可加 `external_dirs`（如 `~/.agents/skills`），路径优先级 project → local → create_dir → external_dirs。
- 渐进披露：Level 0 `skills_list()` 索引 ≈3k token 进 system prompt；Level 1 `skill_view(name)` 全文；Level 2 取 `references/` 单文件。
- `skill_manage` 动作：`create` / `patch`（首选，省 token）/ `patch`+content 整篇重写 / `delete` / `write_file` / `remove_file`；每个动作只广告自己的文本槽，跨槽直接拒。
- 内容硬要求：技能「捕捉教训，不是日志」；PR/issue 编号、日期、引用的聊天都**不是**技能内容；`references/` 按主题少量文件、就地扩写。
- advisory linter 三条：`incident-log-shape`、`references-sprawl`（>60 个 references）、`oversized-body`（正文 >~24k 字符）。只警告不阻断。
- Curator（技能维护者）：存在理由就是「没有维护就会积累几十个窄的近重复技能，污染目录、浪费 token」。触发不是 cron，而是**不活动检查**：距上次运行 ≥ `interval_hours`（默认 168h）且已空闲 ≥ `min_idle_hours`（2h）；首次运行只 seed `last_run_at`，推迟一整个周期。
- 两阶段：(1) 确定性转移、无 LLM：14 天未用标 stale、30 天未用移入 `.archive/`；pinned 与任何 cron job 引用的技能跳过；`use_count == 0` 有宽限地板（"零使用是证据缺失，不是可丢弃的证明"）。(2) LLM 合并**默认 OFF**，一次全量 sweep 典型 50–100 次 API 调用。**从不自动删除**。
- 默认值（`hermes_cli/config_defaults.py:1497-1520`）：`curator.enabled: true`、`interval_hours: 24*7`、`min_idle_hours: 2`、`stale_after_days: 14`、`archive_after_days: 30`、`consolidate: false`、`prune_builtins: false`（注释记录过事故「57 个内置技能在一次启动 tick 里消失」）、`archive_ttl_days: 0`（归档永不自动清理）、`backup.{enabled: true, keep: 2}`、`ledger: true`。

### 1.5 官方默认值一览

| 项 | 默认 | 证据 |
|---|---|---|
| `memory_char_limit` | 2200 | `hermes_cli/config_defaults.py:1317` |
| `user_char_limit` | 1375 | `hermes_cli/config_defaults.py:1318` |
| `memory.nudge_interval` | 10 | `hermes_cli/config_defaults.py:1321` |
| `write_approval` | false | `hermes_cli/config_defaults.py:1319` |
| `curator.interval_hours` | 168 | `hermes_cli/config_defaults.py:1497-1520` |
| `curator.consolidate` | false | 同上 |
| `skills.creation_nudge_interval` | 15 | 见 #67582 |

---

## 2 社区 issue 报告的问题与根因

| issue | 症状（实测数字） | 根因 |
|---|---|---|
| #90035 | 长期记忆**没有任何周期维护**，只有硬字符上限；接近上限后新写入被拒、要用户手动叫 agent 清理；陈旧条目永久留着每轮注入 | 技能有 curator、上下文有 compression，记忆侧一条维护路径都没建 |
| #30199（PR） | 到上限就硬报错 | 缺「按分数淘汰」；提案给条目加 `[YYMMDD\|count\|source]` 内联标签 |
| #67582 | 磁盘 152 个技能，**22 个零使用近重复**（`ai-voice-cloning` vs `ai-dubbing-voice-cloning`、`agnes-image-generation` vs `agnes-media-generation` vs `agens生图`），用户手工 `rm -rf` 17 个 | 创建只防同名覆盖，内容 ~90% 相同照过；curator 确定性阶段只 stale/archive，**从不合并两个都活着的近重复**，LLM 合并默认关 |
| #102811 | 技能被过度加载、渐进披露失效、压过技能描述里的负向路由 | `prompt_builder.py` "If a skill matches or is even partially relevant … you MUST load it … Err on the side of loading" |
| #25833 | 自建技能缺机制级保证 | 结构性：agent 同时是作者、执行者、质检者，没有外部验证点（关联 #6051 learned helplessness 已修、#416 仍 open） |
| #135039 | 「memory accretes into a second, worse session history」：陈旧事实、祈使句劫持后续会话、重复流程 | 写入时无形状检查（陈述句/祈使句）、无语义检查（是否真是每会话都用）、无时效感知 |
| #75130 | `write_approval` 下 8.4 天 357 条技能提议（≈42/天）、**零批准**、无上限无 TTL；75/357（21%）因 patch 锚点失效永久作废 | 提议队列无容量、无过期、无通知 |
| #19986 | bundled 技能同步会把用户删掉的又装回来 | bundled 播种无「用户已删除」记忆 |

**根因归纳（四条）**

1. **上限只挡写入，不挡陈旧**：2200 字符是唯一闸门，满了就报错，于是「最新的先写、最旧的永远留着」。
2. **维护机制默认关闭**：curator 的 LLM 合并默认 OFF、`prune_builtins` 默认 OFF，确定性阶段只会归档，不会合并活着的近重复。
3. **写入时没有形状与语义检查**：作者=执行者=质检者，只有 advisory linter（只警告不阻断）。
4. **人工审批队列没有生命周期**：pending 目录无上限、无 TTL、无提醒，且 patch 锚点会随外部编辑失效。

---

## 3 pi 生态的三个记忆插件

### 3.1 `pi-hermes-memory` 0.9.11（MIT，github.com/chandra447/pi-hermes-memory）

- 定位：Hermes 的 pi 移植版，「Persistent memory + session search + secret scanning」，README 自述 732 tests。
- 存储形状：`MEMORY.md`（事实）/ `USER.md`（画像）/ `failures.md`（按 `failure`/`correction`/`insight`/`preference`/`convention`/`tool-quirk` 分类）/ `skills/<slug>/SKILL.md` / `sessions.db`（SQLite FTS5，会话索引 + extended store）。全局层 `~/.pi/agent/pi-hermes-memory/`，项目层 `~/.pi/agent/projects-memory/<project>/`。
- 容量：`memoryCharLimit` / `userCharLimit` / `projectCharLimit` 各 **5000**；`STANDING.md` 硬顶 **20 条 / 2000 字符**，独立预算。
- 注入时机：**默认 policy-only**——system prompt 只放 `<memory-policy>` 一小段「何时该 `memory_search`、记忆是上下文不是指令」，不注入 Markdown 全文；`memoryMode: "legacy-inject"` 才恢复整篇注入。`STANDING.md` 例外，**每会话必注入**，且放在 policy 之后的 `<standing-instructions>` 块里读作用户指令。
- 工具面：`memory_add` / `memory_replace`（`old_text` 子串）/ `memory_remove`（`target` ∈ memory/user/project/failure）、`memory_search`、`session_search`、`skill_manage`（create/view/patch/update/delete）。
- 去重与过期：完全同名 slug → 拦截；**近名 + 描述高相似 → 拦为 similar**；近名 + 描述低相似 → 拦为 name collision。条目带时间戳供 consolidation 判断陈旧；`memoryOverflowStrategy: "auto-consolidate"` 满时起一次性 LLM 合并；`consolidationChunkChars: 4000`、`consolidationTimeoutMs: 180000`。
- 其他值得抄的：`Correction Detection`（用户纠正即存，不等后台复盘）、`Secret Scanning`（API key/token/SSH key 拦在持久化之前）、每 10 轮 / 15 次工具调用触发后台复盘、FTS5 trigram tokenizer（纯 CJK 子串可搜，1–2 字不命中）。
- 代价：依赖 `better-sqlite3` 原生模块（Homebrew Node ABI 不匹配会坏，README 专门写了 rebuild 指引）。

### 3.2 `pi-memory` 0.4.2（MIT，github.com/jayzeng/pi-memory）

- 存储：`~/.pi/agent/memory/{MEMORY.md, SCRATCHPAD.md, daily/YYYY-MM-DD.md, recovery/<id>.json}`，纯 Markdown，单文件 `index.ts`、无构建。
- 注入：**每轮前**按优先级注入——scratchpad（≤2K）、今日日志尾部（≤3K）、`MEMORY.md`（≤4K，中间截断）、昨日日志（≤3K），**总计硬顶 16K 字符**。
- KV cache 处理很细：默认 `stable` 模式在 `session_start` 拍一次快照，整会话不再重渲染（长期写入与跨天都不刷新，理由是刷新会废掉整个前缀缓存）；删除/恢复**故意**刷新（"forgotten content must disappear from the prompt immediately"）。`PI_MEMORY_SNAPSHOT=refresh|per-turn` 可退回旧行为。
- 工具：`memory_write` / `memory_forget` / `memory_restore` / `memory_read` / `scratchpad` / `memory_search`（需 qmd）/ `memory_status`。
- 去重与过期：**没有去重、没有 TTL**；`memory_forget` 会先把完整条目写进 `recovery/` 再删，返回 recovery id 供 `memory_restore`。
- 检索：可选 `qmd`（keyword BM25 ~30ms / semantic ~2s / deep hybrid+rerank ~10s），未装则核心工具照常工作。
- 其他：压缩时自动写 `## Session Handoff` 到当日日志；退出时 LLM 写 exit summary（可关）。

### 3.3 `gentle-engram` 0.4.2（MIT，github.com/Gentleman-Programming/engram）

- 形态与上面两个完全不同：**Go 单二进制 + SQLite FTS5（`~/.engram/engram.db`）**，通过 CLI / HTTP / MCP / TUI 暴露，支持 14 种 agent（含 pi、Claude Code、Codex），可选 cloud 同步。
- 工具面（27 个 MCP 工具）：`mem_save` / `mem_search` / `mem_timeline` / `mem_get_observation` / `mem_update` / `mem_consolidate`（需预览+显式确认）/ `mem_judge` / `mem_compare` / `mem_session_summary` / `mem_session_finalize` / `mem_doctor` / `mem_save_prompt`。
- 结构约定：条目按 `**What / Why / Where / Learned**` 四段写；project-aware（`--project` / `ENGRAM_PROJECT` / cwd 推断）；冲突显式 surfaced 给 agent 判断；`engram tui` 可浏览、搜索、复制；beta 有 Obsidian 导出。
- 对本项目的意义：**不适合直接照抄**（Go 二进制、第二运行时、cloud 概念），但「project 作用域 + 冲突 surfaced + TUI 浏览 + doctor」四点可借。

### 3.4 对比与 license

| 维度 | pi-hermes-memory | pi-memory | gentle-engram |
|---|---|---|---|
| license | MIT | MIT | MIT |
| 存储 | Markdown + SQLite FTS5 | 纯 Markdown | SQLite（Go 二进制） |
| 常驻注入 | 默认 policy-only（几乎为 0） | 每轮 ≤16K | 无（MCP 按需） |
| 容量控制 | 5000×3 + consolidation | 16K 注入顶 + 分段截断 | 无硬顶，靠 consolidate |
| 去重 | 完全相同条目 + 技能近重复拦截 | 无 | `mem_judge`/`mem_compare` 显式 |
| 过期 | 时间戳 + consolidation | 无 | `mem_review` + 冲突 surfaced |
| 依赖风险 | `better-sqlite3` 原生模块 | 无（qmd 可选） | 需另装 Go 二进制 |

**license 结论**：三者都是 MIT，允许照抄代码（保留版权与许可声明）；`pi-hermes-memory` 本身又是 Hermes（MIT）的移植，Yonder 已经在 `plugins/hermes-experience/NOTICE` 里按同一套路做了 MIT 归属（固定 commit `0eb4f62a8b35ff3b0454a8dbdbd3a7b55a6849b0` 与 `4dcef215cfe41bd2d02c2d1dad6e257a18101216`，完整许可在 `assets/Hermes-MIT.txt`），继续沿用这个做法即可，不需要新许可。

---

## 4 Yonder 现状

### 4.1 `plugins/memory`（日志式记忆，`docs/spec/15-memory.md`）

- 定位：为**一个人**维护独立于任何 agent 的资料库，「不含向量检索、图谱、自动画像管线」（`docs/spec/15-memory.md:3`）；根目录必须在所有 agent 工作区之外，多 agent 共用（`:7-13`）。
- 存储：`timeline/YYYY-MM/YYYY-Www.md` 周文档 + 只追加的记录流（`:57-110`）、`me/{now,profile,mind}.md`、`raw/`、`inbox/`、`log.md`（`:237`）、`.memory/manifest.json`。
- 工具 9 个（`:117-131`）：`memory_status/search/read/capture/plan/review/me/import/bootstrap`。
- 注入两个上下文：`memory-core`（system，`me/now.md` + `profile.md`/`mind.md`，预算 `context.meChars` 默认 2000，`:226`）与 `memory-week`（turn，`:227`）。
- **没有任何淘汰机制**：全仓 `grep -n 'stale|archive|prune|expire|TTL' plugins/memory/src/*.ts` 只命中 `archive/duplicates/`（inbox 去重）、`bootstrap.staleDays: 7`（只用于发提醒事件，`plugins/memory/src/bootstrap.ts:208`）与 `store.ts:43` 的锁超时。也就是说，`docs/spec/15-memory.md` 的「本期不做」（`:310`）里没有写淘汰，实现里也没有。

### 4.2 `plugins/hermes-experience`（Hermes 式 MEMORY.md/USER.md + 技能学习）

- 包名 `@yonder/plugin-hermes-experience` 0.2.26102705，license Apache-2.0，Hermes 参考部分 MIT（`NOTICE`）。
- 记忆：`src/store.mjs:8` → `export const LIMITS = { memory: 2200, user: 1375 }`，`DELIMITER = "\n§\n"`（`:7`），满额时返回 `current_entries/used/limit/needed`（`store.mjs:180-193`）——与 Hermes 完全同构。
- 学习循环：`src/review.mjs:14-15` `QUIET = 15000`（前台静默 15 秒）、`AGE = 30 * 60 * 1000`；`review.mjs:349-352` → 记忆复盘每 **10 turn**、技能复盘每 **10 模型迭代**，`focus` 合并为 `combined|memory|skills`；nudge 计数在排程时就归零（"A Nothing-to-save review must not run again on every subsequent turn"）。
- 技能：`src/skill-store.mjs:14` 名字必须匹配 `^hermes-learned-[a-z0-9]+(-[a-z0-9]+)*$` 且 ≤64 字符；归档目录是 skills 同级的 `.hermes-skill-archive`（`:374`），归档/恢复带 UUID 后缀与 `archive_name_mismatch` 校验（`:382-426`）。
- 写入门：只有**无人值守的破坏性记忆编辑**会 stage 到 `.hermes-pending`（`store.mjs:187-213`，单条上限 256KB）；技能写入**不排队**，直接落盘。
- 提示词：`src/guidance.mjs:6` "Memory is the narrow exception: confirmed declarative facts useful across tasks, not procedures, transient progress or instructions. Never credentials."；`:14` 要求技能写「prerequisites, tested steps, verification evidence and limitations」。

### 4.3 两个同名 `hermes-experience` 与 `hermes-workspace`

| 位置 | 版本 / license | 内容 | 谁更新 |
|---|---|---|---|
| `~/Documents/yonder-harness/plugins/hermes-experience` | 0.2.26102705 / Apache-2.0 | 官方包：`src/{store,skill-store,review,review-prompts,guidance,recipe,index}.mjs`（index 351 行、skill-store 434 行、review 528 行）+ `docs/learning-{runtime,store-api}.md` + `skills/hermes-yonder/SKILL.md` | **更新**：集成于 2026-10-24 提交 `7cf1a59`，随后随每次 release 更新（最新 `0211948` 2026-10-27 10:08） |
| `~/Documents/yonder-hermes-extensions/packages/hermes-experience` | 0.1.1 / 无 license 字段 | 开发源：同样的 `index/review/skill-store/guidance/review-prompts`，但**没有 `store.mjs`**，index 132 行、review 233 行（约官方版一半） | 最后提交 `84def0e` 2026-10-27 08:10（`feat/hermes-learning-parity-20261025` 合并） |
| `~/Documents/yonder-hermes-extensions/packages/hermes-workspace` | 0.1.0 | 只有一个只读工具 `hermes-workspace_preview`（`index.mjs:11-18`），`preview.mjs` 只做目录 kind 判定（`missing/directory/file/symlink-refused`），注释写明 "No Hermes imports, config parsing, credential value reads or executable output"；源码停在 2026-10-21 | 已停更 |

结论：**harness 里的那个是唯一维护版**，`yonder-hermes-extensions` 是它的开发源仓库（0.1.1 分支早于 parity 合并）；`hermes-workspace` 是一次未完成的「Hermes home 迁移预览」实验，与记忆功能无关，可归档。

关于「learning 插件」：仓库与 npm 里**没有**名为 learning 的插件（`grep -rln 'learning' plugins/*/package.json` 只命中 `plugins/hermes-experience/package.json`）。所谓 learning 就是 `hermes-experience` 内部的技能学习子系统（`skill-store.mjs` + `review.mjs` + `<home>/.yonder/plugins/hermes-experience/learning-state.json`）。

### 4.4 本机真实数据：自由生长发生了吗

配置（`~/.local/share/yonder-harness/home/yonder.yaml`）：

- `:26-32` memory 插件 `root: ~/Memory`，`owner: person:owner`，`allowedAgents: [main, memory-keeper]`，`capture.enabled: true`、`inlineMax: 400`。
- `:64-71` hermes-experience 只对 **agent `hermes`** 开 scope（`memoryDir: .../agents/hermes/memories`、`writeMode: exclusive-yonder`、`learning: true`、`skillDir: .../agents/hermes/skills`）。
- `:176-178` `memory-keeper` 已 `archivedAt: 2026-10-27T15:15:00.000Z`。

实测：

| 指标 | 数值 | 证据 |
|---|---|---|
| `agents/hermes/memories/MEMORY.md` | **0 字节**（创建于 10-22 02:35，从未写入） | `ls -la ~/.local/share/yonder-harness/home/agents/hermes/memories` |
| `agents/hermes/memories/USER.md` | **0 字节** | 同上 |
| 全机 `hermes-learned-*` 技能 | **1 个**：`agents/hermes/skills/hermes-learned-release-acceptance`，SKILL.md 9,876 字节 + 1 个 references | `find . -name SKILL.md`（agents 下） |
| home 级 `skills/` | 1 个（`rhythm-clues`） | `~/.local/share/yonder-harness/home/skills/rhythm-clues/SKILL.md` |
| `~/Memory` 规模 | 352 文件 / 1.2MB / 118 个 timeline 文档（84 个周文档） | `find . -type f \| wc -l` |
| 记录总数 | **838** 条 | `grep -rh '^- \[' timeline \| wc -l` |
| 未整理 / 已整理 | **681 / 157**（未整理 81.3%） | `grep -rh '^- \[ \]'` / `'^- \[x\]'` |
| 无正文记录（仅图片元数据） | **403** 条（48.0%） | `sed` 去前缀后 `length<12` 计数 |
| 最大周文档 | `timeline/2026-10/2026-W43.md` = **69,284 字节** | `ls -la timeline/2026-10` |
| `log.md` | **214,721 字节 / 2,038 行** | `wc -l log.md` |
| `me/mind.md` | **5,002 字节**，而 `memory-core` 注入预算默认 **2,000 字符** | `plugins/memory/src/contexts.ts:82-89` |
| 共享技能目录 `~/.agents/skills` | 21 个顶层目录 / **37 个 SKILL.md** / 2.2MB，36 个在 10 月改过 | `find . -name SKILL.md` |

判断：

1. **`MEMORY.md`/技能侧还没膨胀**——但代价是它基本没被用起来：装了 5 天、0 字节。Hermes 式记忆在 Yonder 里的现状是「空转」，不是「泛滥」。
2. **日志侧已经在膨胀**，而且形状很差：81% 未整理、48% 是无正文的图片占位、单个周文档 69KB。这比 Hermes 的 `MEMORY.md` 问题更早出现，因为日志是「只追加、无淘汰」的。
3. `me/mind.md` 已经超出注入预算 2.5 倍：`contexts.ts:89` 把拼好的三段整体 `.slice(0, budget)`，**mind.md 实际上几乎全被截掉**，而用户以为它生效了。
4. 共享技能目录的膨胀是**人写**的（21 个技能、`frontend-workbench` 与 `product-engineering-workbench` 各带 6 个 internal 模块 + vendored 副本），不是 agent 自发生成，但它说明「按主题拆文件」这个诱惑在 Yonder 里同样存在。

### 4.5 已发现的实现缺陷（本轮只读核对）

1. **`memory-week` 上下文永远不渲染**：`plugins/memory/src/contexts.ts:100` 读 `timeline/${week}.md`，而文件实际在 `timeline/${month}/${week}.md`（`src/calendar.ts:18`、`capture.ts:74`）。后果：本周计划从不进模型上下文。
2. **注入预算按「拼接后整体截断」**：`contexts.ts:89`，导致 `mind.md` 被静默丢弃，没有「省略了几条」的提示（对比 pi-memory 的 16K 分级预算与 pi-hermes-memory 的截断声明）。
3. **凭据明文进记录流**：`timeline/2026-10/2026-W44.md:179` 有一条 `{chat}` 记录直接包含 QQ AppID/Secret 明文（本报告不复述其值）。`docs/spec/15-memory.md` 只规定「正文一个字都不改」，没有 Hermes 那样的写入前 secret scan。
4. **无淘汰、无 TTL、无合并**：见 §4.1。
5. **`hermes-experience` 技能创建没有近重复拦截**：`src/skill-store.mjs` 只有同名冲突（`:240` `skill_already_exists`）与 revision 冲突（`:151`），没有 `pi-hermes-memory` 那种「近名 + 描述相似度」判定，即 #67582 的根因未修。
6. 文档悬空引用：`docs/decisions.md:128`（D45）写「用户个人资料库见 D50」，但现行 D50 是凭据录入（`docs/decisions.md:149`）。

---

## 5 已有设计约束

- `docs/decisions.md:104-106`（D41）：「memory 仅手工目录，**不引入记忆引擎或自动注入**」。这条与现存 `plugins/memory` 的 `memory-core` 自动注入已经冲突，`F1-notes.md:12` 已指出「任何自动注入都是设计变更」。
- `proposals/unified-client/research/F1-notes.md`：
  - `:8-9` 现状诊断：memory 插件是「按时间线记账」不是「按实体挂笔记」，实体只以行内引用文本存在；推荐**方案 A**——在 memory 插件里加 `entities/<type>/<id>.md` 笔记区，复用同一存储/检索/隐私/上下文贡献，**不要**新开第二套存储闭环。
  - `:104-120` 三个新贡献的注入预算建议：进会话 ≤300 字符、首次出现该发送者 ≤300 字符、模型备注 ≤200 字符；显式 `memory_note get` 走工具返回（沿用 `memory_read` 的 12000 字符上限）。
  - 文末「主 Agent 裁定（10-27）」：采用方案 A；`memory_note` 工具（`get/set/append/supersede/list`）；第二步给 SDK `RenderContext` 加 `model?: {provider,id}`；**D41「不自动注入」被部分替代**，实施归 A 线、排在 agent-parity P4 之后。

因此本报告第 7 节的方案必须落在这个裁定之内：**一个插件、一个存储、一个工具面**，不再新开插件。

---

## 6 可照抄的部分（附 license 说明）

| 要抄的东西 | 来源 | license | 照抄方式 |
|---|---|---|---|
| `MEMORY.md`/`USER.md` 的 2200/1375 上限、`§` 分隔、用量首行、满额报错回传 `current_entries/needed` | Hermes（`tools/memory_tool.py`、`memory_tool_store.py`） | MIT（`NOTICE` 已记 commit `4dcef21`） | 已在 `plugins/hermes-experience/src/store.mjs:7-8,180-193` 实现，直接复用 |
| `add/patch/remove` 三动作 + 拒绝整条 `replace` | Hermes | MIT | 同上（`editMemory`） |
| 「记忆是窄例外、技能优先、写陈述句不写祈使句、一周内会过期的事实进会话历史」 | Hermes `agent/prompt_builder.py:195-236` | MIT | 已改写进 `plugins/hermes-experience/src/guidance.mjs:6`，可移植到 memory 插件 |
| 后台复盘（每 10 turn / 10 迭代、15 秒静默、破坏性编辑 stage、`/refine` 显式） | Hermes `agent/background_review.py` 等 | MIT | 已在 `plugins/hermes-experience/src/review.mjs:14-15,349-352` 实现 |
| 技能归档可恢复（`.archive` + `absorbed_into` + 备份/回滚） | Hermes curator | MIT | 部分已在 `skill-store.mjs:371-426`；**缺**备份 tar.gz 与 rollback |
| **policy-only 注入**（system prompt 只放一小段策略，不注入全文） | `pi-hermes-memory` | MIT | 直接照搬思路，能立刻解决 `mind.md` 被截断问题 |
| **`STANDING.md`**：人写、每会话必注入、硬顶 20 条/2000 字符、agent 不能把自己的记忆提升进去 | `pi-hermes-memory` | MIT | 照抄；这是「禁止类规则」唯一可靠的载体（README 原文：preferences survive a missed lookup; prohibitions do not） |
| 技能近重复拦截（同名 / 近名+高描述相似 / 近名+低相似三分支） | `pi-hermes-memory` | MIT | 照抄到 memory 插件的技能提议环节 |
| 写入前 secret scan | `pi-hermes-memory` / Hermes | MIT | 必须抄，本机已泄漏一次（§4.5 第 3 条） |
| 分级注入预算 + 中间截断 + 省略声明 | `pi-memory` | MIT | 抄预算表，解决 §4.5 第 2 条 |
| KV cache 稳定的会话快照（只在 `session_start` 与删除/恢复时刷新） | `pi-memory` | MIT | 抄语义；Yonder 已有 system 上下文确定性要求（D42） |
| `recovery/` 可恢复删除（forget 前先存完整条目 + 返回 id） | `pi-memory` | MIT | 抄，补 memory 插件「删除」动作的缺口 |
| 条目结构化 `What/Why/Where/Learned` + 冲突 surfaced 给 agent 判断 | `gentle-engram` | MIT | 只抄字段约定，不抄 Go 二进制 |
| 实体笔记区 + `memory_note` + `memory-entity` 贡献 | 本项目 `F1-notes.md:3.5` | 自有 | 按裁定实施 |

**不要抄的**：Hermes 的「技能索引 `MUST load / err on the side of loading`」提示词（#102811 已证明会造成过度加载）；Hermes 的「记忆满了就报错、不自动压缩」；`write_approval` 的无界 pending 队列（#75130）；Curator 的 LLM 合并默认关但又被期望去重的矛盾设计。

---

## 7 合并方案草案：一个默认记忆插件

### 7.1 目标与不做什么

目标：**每个 Agent 默认装上**，一个插件同时覆盖四类记忆，共用一套存储、一套隐私规则、一套工具前缀、一个用户可见界面。

| 层 | 内容 | 常驻？ | 容量 |
|---|---|---|---|
| L1 画像（profile） | 用户是谁、偏好、沟通风格、环境事实 | 是 | 硬顶，见 §7.3 |
| L2 实体笔记（entities） | `conv:`/`acct:`/`person:`/`model:` 挂的短笔记 | 按需注入 | 每实体硬顶 |
| L3 日志（timeline） | 按周记账、只追加 | 否（检索） | 无硬顶，但**必须**有整理率指标 |
| L4 经验（skills） | 可复用流程、坑、验证方法 | 只索引 | 索引硬顶 |

不做：向量检索与索引（沿用 `docs/spec/15-memory.md:3`）、第二个 SQLite 存储、第二套工具前缀、自动合并（自动合并必然要模型判断，属「推断」，违反 `:11`）。

### 7.2 存储与工具面

- 存储全部落在现有 memory 根目录（`~/Memory`）：`me/`（L1）、`entities/<type>/<safe-id>.md`（L2，新增，`F1-notes.md:3.2`）、`timeline/`（L3）、`skills/`（L4，新增，指向 agent 的 skillDir 或根目录内 `skills/`）。
- 工具面收敛为 `memory_*` 一族（现有 9 个 + `memory_note` + `memory_skill`）。`hermes-experience` 的 `memory_read/memory_edit/skill_store/memory_pending/refine` 不再对外暴露，改为内部实现细节或被删除（§7.8）。

### 7.3 容量预算与淘汰

| 层 | 预算 | 满时行为 | 淘汰规则 |
|---|---|---|---|
| L1 画像 `me/profile.md` | 2200 字符（照抄 Hermes） | 工具返回 `current_entries/used/limit/needed`，要求**批量** patch/remove 后重试，不自动压缩 | `{confirmed}` 条目永不自动删；`{inferred}` 超 60 天未 `confirm` → 降级到 `me/mind.md` 历史节 |
| L1 `me/now.md` | 800 字符 | 只允许 `memory_me supersede` | 被 supersede 的进 `## 历史`，历史保留最近 20 条 |
| L2 实体笔记 | 每实体 **5 条 / 1200 字符**；每类最多 200 个实体文件 | 工具直接报错「先合并」，学 Claude Code 的写回被拒 | `status: expired` 或 `updated` 超 180 天 → 移入 `archive/entities/`，注入时过滤 |
| L3 日志 | 无硬顶，但**周文档 ≤ 48KB**、**未整理率 ≤ 20%** | 超 48KB 时 bootstrap 发 `memory.attention`，并在 `memory_status` 标红 | 图片/空正文记录不落正文（只留指针 + 媒体元数据）；`archive/duplicates/` 已有 |
| L4 技能 | 索引 ≤ 3000 token（≈ 40 个技能）；单 SKILL.md 正文 ≤ 24k 字符 | 索引超预算 → 拒绝新建，只能 patch/合并 | 90 天 `use_count == 0` → 标 `stale`；180 天 → 移入 `.archive/`；**永不物理删除** |

注入预算（照 `F1-notes.md:104-120`）：`memory-core`（画像）≤ 2000 字符且**分级截断并声明省略条数**；`memory-entity` ≤ 300 字符/实体、≤ 600 总计；`memory-week` 修复路径后 ≤ 1200 字符。全部走「会话快照」语义（`pi-memory` 的 stable 模式），删除/恢复时才强制刷新。

### 7.4 写入门槛

写入分三条独立通道，门槛不同：

1. **日志（L3）**：无门槛，但要过**形状过滤**——空正文/纯图片记录只写指针不写正文；命中 secret scan 的直接拒写并在 `log.md` 记一条「refused: secret-shaped」。
2. **画像（L1）与实体笔记（L2）**：沿用现有 evidence 规则（`docs/spec/15-memory.md:129`、`:149`）——标 `confirmed` 必须带 `evt:<id>` 或记录条目 id，否则只能 `inferred`。新增三条形状检查（对应 #135039）：陈述句（拒绝「Always …」「Never …」祈使句，这类只能进 `STANDING.md` 且由人写）、非凭据形状、非流程（流程判给 L4）。
3. **技能（L4）**：必须带「前置条件 / 已验证步骤 / 验证证据 / 已知限制」四段（`plugins/hermes-experience/src/guidance.mjs:14` 已有此要求），并过近重复拦截（§7.6）。

`STANDING.md` 是唯一例外：只有人和显式 `/memory pin` 能写，硬顶 20 条/2000 字符，每会话必注入。

### 7.5 定期整理（谁、何时、成本）

| 任务 | 执行者 | 触发 | 成本 |
|---|---|---|---|
| 日志整理（`memory_review organize`） | `memory-keeper` 预设（read/write/admin，无 exec/network） | 未整理数 ≥ 20 条 **或** 距上次 ≥ 24h；由 `memory-bootstrap` 的 `backlog` 信号驱动 | 每 20 条一次模型调用，输入 ≈ 记录正文（≤ 8k token），用便宜模型 |
| 画像/实体笔记去重与过期 | 同上 | 每 7 天，且只在「空闲 ≥ 2h」时跑（照 Hermes curator 的 inactivity 检查） | 1 次调用，输入 = L1+L2 全文（≤ 6k token） |
| 技能 stale/archive | **纯确定性，无模型** | 每 24h 检查一次，7 天一次真正执行 | **0** |
| 技能合并（近重复） | 主 Agent 在用户在场时提议 | 由近重复拦截或 `use_count` 触发，生成 `absorbed_into` 提议 | 一次 1–3 次调用，仅对候选 |
| 容量审计 | `memory_bootstrap(audit)` | 手动/每周 | 1 次调用（已有 gpt-tokenizer 估算，`docs/spec/15-memory.md:204`） |

关键原则：**确定性的事不用模型**（stale/archive/超预算报错），**要模型判断的事默认关或只在人前跑**（合并、自动压缩）。这正是 Hermes curator 做对的一半（确定性转移）和做错的一半（LLM 合并默认关却又被期待去重）。

### 7.6 技能从提议到采纳

流程（每步都有落盘记录，可审计）：

1. **提议（proposal）**：复盘或前台 agent 调 `memory_skill propose`，只写 `<root>/skills/.proposals/<uuid>.json`，字段 = 名字、四段正文、触发条件、证据 `evt:`、`use_when`。**不进** `skills/`，不被索引发现。
2. **拦截（deterministic，无模型）**：同名 → 拒（指向 patch）；近名 + 描述相似度 > 0.8 → 拒并回传最相近的 3 个技能；索引已超预算 → 拒。
3. **试用（adopted-pending）**：用户或主 Agent 批准后落到 `skills/<name>/SKILL.md`，frontmatter 加 `status: trial`、`proposed_by`、`evidence`。
4. **采纳（confirmed）**：被 `skill_view` 加载并**成功使用** ≥ 2 次（记 `use_count`）后自动转 `status: active`。
5. **退役**：90 天零使用 → `stale`；180 天 → `.archive/`（可 restore）；合并时旧技能写 `absorbed_into`。

队列治理（修 #75130）：提议目录**硬顶 20 条**、TTL 14 天、超限时新提议直接拒并提示先处理；每条提议记 `base_revision`，落盘前校验，锚点失效则标记 `obsolete` 而不是静默作废；`memory_status` 报「待采纳 N 条、最老 M 天」。

### 7.7 用户可见的界面

三个入口，按成本从低到高：

1. **`yonder memory` CLI 子命令**（沿用 `docs/spec/13-observation-and-management.md:63-64` 的 CLI 家族，非交互 JSON）：`status`（四层容量条 + 未整理数 + 待采纳提议数 + 最老未整理天数）、`note <entity>`（读写实体笔记）、`review`（列出待整理记录）、`skills`（stale/待采纳/归档）、`pin`（管理 `STANDING.md`）。
2. **卡片/渠道投影**（`plugins/channel-card` 现有思路）：整理完成后在聊天里给一条摘要卡「整理了 12 条 → me/now 3、计划 2、丢弃 7」，**不逐条播报**（Hermes 的 `display.memory_notifications` 就是 `off|on|verbose` 三档）。
3. **文件本身**：`~/Memory` 是 Obsidian 库，用户可直接打开编辑；`log.md` 提供完整审计轨迹。

反向要求：任何「记忆被写入/被淘汰」的动作必须在 `log.md` 留一行，`memory_status` 必须能回答「这条为什么没了」。

### 7.8 与 `hermes-experience` / learning 的合并或删除

现状是**三套并行**：`plugins/memory`（person 级日志）、`plugins/hermes-experience`（agent 级 MEMORY/USER + 技能学习）、`plugins/wechat-archive` 的素材事件。合并方案：

| 组件 | 处置 | 理由 |
|---|---|---|
| `hermes-experience` 的 `MEMORY.md`/`USER.md` 存储与 2200/1375 语义（`src/store.mjs`） | **保留为 L1 的后端实现**，由 memory 插件调用；`memoryDir` 与 memory 根目录的关系二选一：或把 `MEMORY.md`/`USER.md` 搬进 `<root>/me/`，或让 L1 继续读写 agent 的 `memories/` 但由 memory 插件统一预算 | 避免两套预算、两套提示词、两套工具 |
| `hermes-experience` 的后台复盘（`src/review.mjs`） | **保留为唯一复盘引擎**，把目标从「MEMORY.md/USER.md」扩到「L1+L2+L4」 | 它已经把 10 turn / 10 迭代 / 15 秒静默 / 破坏性 stage / `/refine` 都做对了，重写没有收益 |
| `hermes-experience` 的 `skill_store`（`src/skill-store.mjs`） | **降级为 L4 的写入后端**（保留 `hermes-learned-*` 命名与 `.hermes-skill-archive`），上层加 §7.6 的提议/拦截/试用流程 | 它已有 revision 冲突与归档可恢复，缺的只是近重复拦截与提议队列 |
| `hermes-experience` 的 5 个前台工具（`memory_read/memory_edit/skill_store/memory_pending/refine`） | **删除对外暴露**，能力并入 `memory_*`；`/refine` 保留为显式入口（改叫 `memory_refine` 或保留斜杠命令） | 工具面必须只有一个前缀，否则模型会选错 |
| `hermes-experience` 的 `learning` 开关（`yonder.yaml:70`） | 合并为 memory 插件配置的 `learning.enabled`，默认 **true**（因为「每个 Agent 默认装上」） | 现状只有 `hermes` 一个 agent 开着，等于没装 |
| `plugins/hermes-experience` 整包 | 合并完成后**标记 deprecated**，保留一个版本周期，随后从默认发行集移除；`NOTICE`/`assets/Hermes-MIT.txt` 随代码迁移到 memory 插件 | 避免两包各自维护 Hermes 归属 |
| `packages/hermes-workspace`（`~/Documents/yonder-hermes-extensions`） | **归档删除**（只读预览实验，停更 6 天，功能价值 < 维护成本） | §4.3 |
| `~/Documents/yonder-hermes-extensions` 整个仓库 | 保留为历史开发源，不再作为发布源；`README` 里加一行「已并入 yonder-harness」 | 版本号已落后（0.1.1 vs 0.2.26102705） |
| `plugins/memory` 的 6 个 skills | 保留，但补 2 个：`memory-entity-note`（实体笔记怎么用）、`memory-skill-curate`（提议/采纳/退役流程） | 现有 6 个只覆盖日志与复盘 |

### 7.9 实施顺序与验收

1. **修缺陷**（不动设计）：`contexts.ts:100` 周文档路径、`contexts.ts:89` 分级截断 + 省略声明、`capture` 的 secret scan 与空正文过滤。
2. **L2 实体笔记 + `memory_note`**：按 `F1-notes.md:3.5` 第一步，不碰 SDK。
3. **L4 收编**：`hermes-experience` 的 store/skill-store 变成 memory 插件后端，工具面前缀统一。
4. **L1 预算统一**：`MEMORY.md`/`USER.md` 进 memory 根目录，预算与 `me/` 合并。
5. **整理引擎**：把 `review.mjs` 的目标从 2 个文件扩到 4 层，加确定性 stale/archive。
6. **界面**：`yonder memory` CLI + 整理摘要卡。
7. **删旧**：`plugins/hermes-experience` deprecated → 移除；`hermes-workspace` 删除。

验收（真实模型 `openai/gpt-6-luna`，遵守 `AGENTS.md` 第 4 条）：L1 满额时工具报错并给出 `needed`；L2 每实体超 5 条被拒；L3 未整理率从 81% 降到 <20% 且周文档不超 48KB；L4 建近重复技能被拒且回传最相近 3 个；`memory_status` 能解释任意一条记录的去向；`mind.md` 不再被静默截断。

---

## 8 未核实与待决

- **未核实**：`pi-hermes-memory` 的 `similarity` 阈值具体数值（README 只说「high/low description similarity」，未给阈值），照抄时需自定。
- **未核实**：Hermes `skills.creation_nudge_interval` 默认 15 只见于 issue #67582 的引用，未在 `hermes_cli/config_defaults.py` 中定位到该键。
- **未核实**：`docs/decisions.md:128`（D45）「用户个人资料库见 D50」中的 D50 编号是否曾经指向资料库（现行 D50 是凭据录入，`:149`）。
- **未核实**：`~/Memory` 的 403 条空正文记录里，有多少是 `wechat-archive` 的「仅元数据」占位（抽样看是 `媒体: image （仅元数据）`），未做全量归类。
- **待决**（需维护者批准，按 `AGENTS.md` 第 7 条）：D41「不引入记忆引擎或自动注入」的替代文本；L1 是否搬进 memory 根目录（涉及已有 agent 的 `memories/` 路径迁移）；`plugins/hermes-experience` 的 deprecation 时点；是否给 SDK `RenderContext` 加 `model`（`F1-notes.md` 第二步已批准，但依赖 A 线排期）。
- **未测**：本轮为只读调研，未运行任何测试，未实际执行 `memory_*` 工具；`plugins/memory` 的 8 条验收（`docs/spec/15-memory.md:314`）与 `hermes-experience` 的受控验收脚本 `scripts/accept-learning-controlled.mjs` 均未运行。