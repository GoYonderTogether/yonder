# memory 实现待决问题

日期：2026-10-22；分支：`zoran/memory-plugin`。

按本轮任务要求，规范空白或矛盾由维护者决定；本文不修改规范、不选定新行为。

## Q1（已裁决）：根目录位于登记目录内时，首次启动如何处理（阻塞 WP1）

- 规范 §2（`docs/spec/15-memory.md:34–35`）：首次启动按需创建目录与固定文件，外部登记目录不改动。
- 规范 §6.4（第 151 行）：插件从不写入、移动、改名登记目录中的任何文件。
- 规范 §10：`root` 与 `roots` 互相包含时由 `memory_status` 报告；未规定拒绝这种配置或取消初始化。
- 当 `root` 位于某个登记目录之内，或者两者是同一路径时，在 root 创建 `SCHEMA.md` 等文件也会写入登记目录。初始化与登记目录只读承诺不能同时照常执行。

**待决定：**上述配置是否应拒绝启动，或允许仅提供只读 status 并禁止初始化与写入，或另有明确规则？需同时明确 status 在这种情况下的可用性。未自行选择。

**状态：**WP1 在编码前暂停；WP2、WP3 依赖 WP1 的插件包，未开始。

## Q2（已裁决）：逐条 origin 的持久化格式未定义（影响 WP2、WP3）

- 规范 §3（第 40 行）要求每条记录与插件生成的文件携带 `origin`。
- §4.2（第 84–89 行）的记录格式仅包含时间、source、正文、引用与 id，未说明 origin 的位置和语法。
- §5 的 `memory_capture` 允许相同 `{capture}` 来源分别产生 `human-said`（`by: owner`）与 `agent`（默认）记录；两者的 ref 均为调用 agent，因此无法仅由 source/ref 恢复 origin。
- §6.2 要求 origin 过滤与返回每文件 origin；同一周文件可以同时包含多种 origin，未说明文件级返回值与过滤粒度。

**待决定：**记录及生成文件的 origin 存储格式，以及混合来源文件的检索过滤与返回规则。未新增格式或推断规则。

## Q3（已裁决）：term 双搜无法满足康熙部首文本验收（影响 WP3）

- 规范 §6.2（第 138–139 行）要求 rg 字面检索 term 原样与 term 的 NFKC 形式，不建立第二套检索实现。
- runbook WP3 要求“康熙部首文本能被普通汉字 term 命中”。
- 对普通汉字 `文`，NFKC 仍是 `文`；文件中的康熙部首 `⽂` 不会因规范化查询 term 而改变。转换器输出规范化属于 WP4，不能覆盖只读登记目录中原有的兼容字符。

**实际复现：**在系统临时目录创建 UTF-8 文本 `⽂档\n`，用 Node `spawnSync` 直接调用 PATH 中的 rg，不经 shell：

```text
term = "文"; term.normalize("NFKC") = "文"
stored = "⽂"; stored.normalize("NFKC") = "文"
rg --fixed-strings --ignore-case --line-number -- 文 <临时文件>
原样 term：exit 1，stdout 空，stderr 空
NFKC term：exit 1，stdout 空，stderr 空
```

临时目录已删除，未访问任何用户资料库。上述为两个真实命令的无匹配结果，不是插件测试失败计数。

**待决定：**该验收是否仅适用于已由 WP4 规范化的转换产物；若还覆盖原始文本与登记目录，需要明确允许的检索算法。未更改源文件、引入索引或自行增加检索路径。

## 裁决依据与续办

2026-10-22，维护者授权继续 WP1→WP3；依据提交 `a6eac0f`（及 `e6757b0` 复用清单）：

- Q1 已裁决：规范 §10，root 与登记目录相同或互相包含时配置无效，加载返回字段级错误，不初始化。
- Q2 已裁决：规范 §4.2 的来源标签表一一映射 origin；文件 origin 按目录/frontmatter；§6.2 按命中行返回并过滤 origin。
- Q3 已裁决：规范 §6.2 与 runbook WP3/WP4，WP3 验证输入兼容形式的 NFKC 双搜，康熙部首转换产物验收归 WP4。

上文问题描述与复现保留为裁决前记录；暂停状态已解除，按最新规范实施，不沿用上文待决状态。

## Q4（已裁决）：私密月文件混合 origin

以下保留为裁决前记录，暂停状态已解除。

WP1 已完成，提交 `0614027`。复核 WP2–WP3 全部相关条款后，新增待决问题仅本项；Q1–Q3 不再阻塞。

- §5：`memory_capture(by: owner)` 产生 human-said，默认 by: agent 产生 agent。
- §7：所有 private capture 写入 `private/YYYY-MM.md`，同月共用一个文件。
- §4.2：private 文件靠 frontmatter 的 origin；只有周文档的记录行明确按来源标签恢复逐条 origin。
- §6.2：周文档记录行按各自标签确定 origin，其他内容按文件 origin，origin 过滤作用于命中行。

同月先后写入 owner 与 agent 的私密记录时，单个文件 origin 无法同时表达两者。不能自行统一标成 agent/human-said、覆盖既有 origin 或改变既定私密路径；也不能未经裁决把只适用于周文档的逐条标签规则推广到 private。

**待决定：**private 的记录行是否也按来源标签判断 origin（frontmatter 仅作非记录内容的默认值）；或者要求遇到不同 origin 拒绝追加；或另有规则。需同时明确 WP3 对私密命中行的过滤方式。

**状态：**WP2 未开始实现，按任务规则暂停；WP3 尚未开始。已通过交互问题提交维护者裁决请求。未为该问题修改任何规范或实现新行为。

## Q4（已裁决）

2026-10-22，规划方裁决（规范提交 c5f8e9d，§4.2 与 §5.1）：凡含记录行的文件（周文档、`private/YYYY-MM.md`）逐行按来源标签确定 origin；`private/` 文件 frontmatter 只需 `private: true`，非记录内容按 `derived`；WP3 对私密命中行同样按命中行 origin 过滤。同时规范新增 §5.1，列出各工具的参数与返回，以及记录续行、空行、补记（`when`）与日期小标题规则。

## Q5（已裁决；以下为原记录）：inbox 原件字节保留与 raw 来源标签（阻塞 WP4）

本轮基线 `cb8802d`，已合入规范 `6c8fc82` 与初稿 `ffd9196`。已通读 WP4 涉及的 §3、§4.2、§5.1、§6.1、§6.3、§7、§8.2–8.4、§10 与 runbook；本包目前发现的新增待决项仅此一项，不将 §8.4 的实现自定事项列为问题。

- §6.1(3)（当前规范第 159 行）要求文本类原样入库，并将原件移入 `raw/YYYY-MM/<sha256前8位>-<原名>`。
- §4.2（第 103 行）规定 raw 文件靠 frontmatter 的 origin 判定来源；§6.2 的搜索需要据此过滤、返回 origin。
- 若输入为没有 frontmatter 的 md/txt，或自带其他 origin 的 Markdown，给它添加/覆盖 `origin: external` 就改变了原件字节；保持原件字节不变又不能由 frontmatter 得到本次 inbox 来源。对二进制原件同样不能直接添加 frontmatter。
- §8.4 允许自行决定 manifest 的内部结构，但尚未授权它作为原件 origin 的来源来替代 §4.2 的判定规则，因此不自行扩展该语义。

**待决定：**是否允许原件保持字节不变，由 manifest 提供其 origin，生成的转换 Markdown 才写 frontmatter；或“原样”仅指正文、允许给文本原件添加来源 frontmatter；或另有规则。需明确原件已有 origin 时的优先级。

**状态：**WP4 按任务规则暂停，WP5–WP7 尚未开始；已通过交互问题提交裁决请求。仅新增本问题记录，未创建实现提交或运行完成验收。检查命令与 checkPlugin 的本轮计数为“未运行”，不记为通过/零失败。

**准备事实：**用户指定的 markitdown、test.pdf、test.docx、zh.docx、zh.pdf 均存在；仅检查路径可用性，未转换、未访问微信内容或 auth.json，未访问 Obsidian/其他检出文件。未安装依赖、未修改服务或正式配置，未 push/tag/merge。

Q5 裁决依据：440b35a（已合并于 933f484）。原件字节不变，manifest 按路径提供 origin；转换产物和 agent 资料按 §8.4 写 frontmatter。WP4 暂停解除。
