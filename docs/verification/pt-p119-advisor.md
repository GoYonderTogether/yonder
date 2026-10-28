# PT-P119 advisor 验收（2026-10-28）

- 已实现可选 advisor，使用 SDK `subagents.run` 复用 `task_run`；记录默认关闭，ID 属于当前进程和会话，重启后失效。来源与许可证见 `plugins/advisor/NOTICE`。
- 真实内核和 `siliconflow/deepseek-ai/DeepSeek-V3.2`：临时 HOME、只读导入主人 home 的 siliconflow 凭据槽；模型实际调用 `advisor_consult` 和 `advisor_record_advisor_outcome`，私有状态中恰好一条结果。首次 1 通过、0 失败（24.30 秒）；加入未选插件检查后重跑 2 通过、0 失败、0 跳过（49.83 秒）。独立未选 preset 的 pi agent modelTools 不含两个 advisor 工具。
- `npx vitest run packages/core/src/kernel/pt119-live.test.ts --maxWorkers=1`（不启用模型）1 通过、0 失败、1 跳过：以合成委派结果调用真实 T05 文件缓存，验证长输出截断、返回引用、原文读回和 `task_run` 索引；不以此证明真实长模型输出。`npx vitest run plugins/advisor/test/advisor.test.ts`：1 通过、0 失败；验证会话隔离、失败重试、重复、重启失效和默认关闭，该测试的委派结果为测试替身。
- 真实模型命令：`agent-network run -- env HOME=<临时目录> YONDER_PT119_REAL=1 YONDER_PT119_AUTH_SOURCE=<主人 home 的 .yonder/auth.json> npx vitest run packages/core/src/kernel/pt119-live.test.ts --maxWorkers=1`；测试退出时清理实际 Yonder home 与临时凭据，没有保留验收产物。
- 两个工具的名称、描述、schema JSON 分别为 309 和 635 UTF-8 字节；模型 tokenizer 的 token 增量未测，不把字节数当 token。`npx vitest run packages/core/src/runtime/prompt-guidelines.test.ts packages/core/src/kernel/pt119-live.test.ts --maxWorkers=1`：2 文件、3 通过、1 跳过；其中 find/ls 指南用合成规则验证按选中工具注入，未进行真实模型 find/ls 规则验收。
- `npx biome check plugins/advisor package.json tsconfig.json` 与 `npx tsc -b plugins/advisor` 通过；全仓 `npx tsc -b` 曾因并行改动的 `projectRulesFor` 和 code-intel 类型错误失败，`node scripts/check-file-size.mjs` 因并行 `routing/index.ts` 522 行失败。记录的是当时原始结果。
- 同进程同 ID 使用 reserve/commit/release；JSONL 的跨进程竞争和写入中断后的部分行未验收。未测真实模型长输出、跨进程写入和崩溃恢复；不声称完成这些场景。

- 复查：文件行数检查通过；全仓 tsc 再次失败于并行 `control/activity-methods.ts` 与 `kernel/index.ts`。本验收测试曾因跨项目源码导入导致 tsc rootDir 错误，已改为读取构建产物。
