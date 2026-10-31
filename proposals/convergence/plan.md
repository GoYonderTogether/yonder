# Yonder 收敛方案：文档、分层、大文件、内核瘦身

## Context

审查结论（本会话）：边界规则守住了，但 core 18 个模块之间互相依赖、`runtime/index.ts` 1953 行、约 2400 行群聊/社交逻辑进了内核、文档编号冲突、status.md 变成流水账，另有一批 28 文件的未提交改动（2026-10-31 已批准的「群参与收口」）。目标：内核保持 AI 能整体读懂、可安全修改的规模；宿主记录事实而不是模型叙述；具体策略交给插件。

约束（CONTRIBUTING/AGENTS）：直接在 main 上改，不建分支/worktree；主 Agent 只改文档，代码全部交给子 Agent；一个逻辑改动一个提交；不违反不变量；SDK 与冻结契约只增不删（20）；需要模型的测试用真实 `openai/gpt-6-luna`（凭据 `.yonder/auth.json`）。

执行者：子 Agent 用 opus；opus 额度失败时同一任务改用 sonnet 重派。并行的子 Agent 只碰互不重叠的文件，每个只 `git add` 自己的路径。

## 目标分层（core）

```
L0 store(+db.ts), config, signals, status       不得 import L1 以上（含 type）
L1 runtime（唯一 pi 适配 + 叶子工具）, permissions.ts
L2 sessions, tools, skills, prompt, retention
L3 routing → delivery
L4 kernel（组合根）, plugins, views, control, release, imports, bundles.ts, index.ts
```

新增 `scripts/check-layers.mjs`（仿 `check-file-size.mjs`：基线只减不增），接入 `npm run lint`。

## 阶段

**A 收口未提交改动（1 个子 Agent，串行）**
- 修 `packages/core/src/tools/conversation.test.ts:59` 的时间并列抖动（给两个事件明确不同的 ts，不改产品排序）。
- build/typecheck/lint/相关测试 + 真实 Luna 的 social/routing live 用例；按 decisions 2026-10-31 一次逻辑提交。

**B 并行（3 个子 Agent，文件不重叠）**
- B1 文档（主 Agent 自己写，属设计变更）：`15-clipboard-vault.md` 改号 21 并修全部引用、index 补 15-memory；spec 14 两个「## 5」改正；status.md 压成现状页，历史移 `docs/verification/status-history-2026-10.md`；`docs/pt-*.md`、`ch-*.md` 零散状态页移入 verification；architecture.md 增「分层与内核预算」「宿主记录事实」两节及方向说明（任务为工作单位、订阅、任务级授权、observe 档，只写方向不实现）；decisions 记一条。
- B2 分层修复（core）：探索报告的 9 处上行依赖——`runtime/db.ts→store/db.ts`；console 谓词→`config/console.ts`；`kernel/notifications` 拆分；`promptErrors` 上移；`defaultLazyGroups`→`config/defaults.ts`；`tools/catalog.ts→runtime/tool-catalog.ts`、`modelChainRefs→runtime/model-chain.ts`；`checkBudget` 改为 `RuntimeOptions.onUsageSettled` 注入；tools 的 `DeliveryPort` 接口；`canReceivePeerAsk/isConsoleBot`→`config/bindings.ts`（旧位置保留再导出）。加 check-layers 及基线。
- B3 非 core 大文件拆分：`packages/cli/src/index.ts`、`cli/terminal.ts`、`plugins/channel-feishu/src/channel.ts`、`channel-qq/src/channel.ts`、`native-automation/src/index.ts`、`channel-wechat-ilink/src/channel.ts`、`cron/src/index.ts`；每个拆后 ≤500 行并从基线删除，行为不变。

**C 并行（2 个子 Agent，B2 完成后）**
- C1 `runtime/index.ts` 按探索报告拆 15 个文件：字段留在 `Runtime`，新文件导出 `fn(rt: RuntimeInternals, …)`，`index.ts` 做门面，公共 API 不变。
- C2 `core/release/index.ts`、`delivery/index.ts`、`kernel/index.ts` 拆分（同样门面不变）。

**D 内核瘦身（串行）**
- D1 无需新接缝的迁移：`routing/group-session.ts` + `views/social-group.ts`（生产无注册）移入 social 插件的 view；`delivery/outsider-guard.ts`（无生产调用者）确认后删除；`delivery/social-guard.ts` 改由 social 插件现有 `beforeSend` 承担。
- D2 需接缝的迁移（主 Agent 先改 04/11/20 并记 decisions：接缝作为 hooks 槽扩展，不新增插件槽；SDK 只增）：`ParticipationDecision` 钩子（替代 `routing/social.ts` 在路由与投递中的调用）、agent.yaml 段贡献（schema/默认值/校验/审计写入，替代 `config/social-*.ts` 与 `kernel/social.ts` 写入半）、加载后迁移钩子（`card-visitor`）。留在 core：绑定合成（`membershipGroup/officialGroupBinding`）、`admitBatch` 复核、quota、peer、控制面薄门面。更新 golden，真实 Luna 群聊 live 全部通过才提交；不通过则回退本阶段并报告。

**E 最终验收（主 Agent 安排 1 个子 Agent）**
- 干净 `npm ci` → `npm run build && npm run typecheck && npm test && npm run lint`；`YONDER_TEST_REAL=1 YONDER_TEST_AUTH=.yonder/auth.json` 跑 routing/social/kernel/tasks live；记录前后数值（core 非测试行数、>500 行文件数、层违规数）写入 status.md。

## 每个子 Agent 的提交门槛

`npm run typecheck`、`npm run lint`、受影响目录的 vitest、（core 改动）`npm test`；原始结果写进提交说明；失败如实报告，不改断言、不放宽超时、不删检查。

## 不做

不实现订阅/任务级授权/observe（只写进架构方向）；不改不变量；不碰 pi-durable vendored 源码；不发版、不改生产 home 或已安装服务。
