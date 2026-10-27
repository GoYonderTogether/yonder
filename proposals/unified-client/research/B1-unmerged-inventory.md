I'll start by surveying the repos and their state.# Yonder 未合并工作清单（B1）

基线：harness `main` @0211948（2026-10-27）｜Card `origin/main` @09e6f90（2026-10-24）｜pi `yonder/1.3`（远端 55e9146；vendored 基线 45014f2）
只读核查，未做任何写操作。`a/b` = ahead/behind 相对该仓库主线；"非等价" = `git cherry` 中 `+` 的提交数。

## 1. yonder-harness 本地分支（remote: origin=GoYonderTogether，archive=zoran-xc 旧镜像）

| 分支 | HEAD | 基准 | a/b | 已合入 | 规模 | 用途 | dry-merge vs main | 建议 |
|---|---|---|---|---|---|---|---|---|
| yonder/runtime-discipline | 58a9850 10-27 docs(runtime): record runtime discipline guarantees and tests | d3537b2 | 1/307 | 否，1 非等价 | 27 文件 +914/−29 | 运行时纪律保证与测试 | 冲突 10：CHANGELOG.md、docs/decisions.md、docs/spec/03-agents.md、06-delivery.md、docs/status.md、delivery.test.ts、prompt/index.test.ts、prompt/index.ts、runtime/index.ts、limits.ts | **MERGE**（变基重放）：main 完全没有 `docs/verification/runtime-discipline.md` 与 `packages/core/src/kernel/runtime-discipline.test.ts`；但 runtime/delivery 代码已被 main 大改（runtime/index.ts main 侧多 51 行、delivery/index.ts main 侧多 202 行），需人工重放 |
| yonder/card-plugin | 28ae1bf 10-27 feat(card): add card channel plugin with device login and multi-agent routing | aaf23e3 | 19/352 | 否，14 非等价 | 142 文件 +9673/−99 | 名片渠道 + companion UI + 微信迁移合集 | 冲突 10+：CHANGELOG.md、THIRD_PARTY_NOTICES.md、biome.json、brand/README.md、brand/src/yonder-mark.js（add/add）、docs/architecture.md、docs/decisions.md、docs/index.md、docs/plugins.md、docs/spec/01-events.md | **SPLIT + ARCHIVE**：`plugins/channel-card`、`plugins/ui-companion`、`plugins/channel-wechat-ilink`、`plugins/wechat-archive`、`plugins/clipboard` 都已在 main（85 个新增文件中 29 个与 main 逐字节相同、25 个是更旧版本）；main 仍缺 31 个：`brand/assets/**`、`brand/scripts/build.mjs`、`proposals/ai-card/*`、`proposals/card-studio/*` → 只捞这些，分支打 tag 归档 |
| yonder/clipboard-vault | fdc88b6 10-27 feat(clipboard): add clipboard vault plugin workspace | f820996 | 2/328 | 否，2 非等价 | 33 文件 +1991/−7 | 剪贴板/Keychain 保管库 | 冲突 10+：CHANGELOG.md、docs/decisions.md、docs/index.md、docs/plugins.md、docs/reference.md、docs/spec/04-plugins.md、package-lock.json、package.json、delivery.test.ts、packages/sdk/src/types.ts | **ALREADY-IN（删）**：19 个新增文件中 16 个与 main 相同，3 个不同（`plugins/clipboard/package.json` 2/2、`test/clipboard.test.ts` main 多 34 行、`test/real-model.test.ts` main 多 111 行）→ main 更新，分支是旧版本 |
| archive/main-before-rightapi-20261023 | dfb9f5f 10-21 docs: 添加 AI 名片与 Agent 聊天平台最小闭环设计草案 | aaf23e3 | 7/352 | 否，4 非等价 | 64 文件 +3600/−58 | rightapi 改造前快照 | 冲突 10+：CHANGELOG.md、THIRD_PARTY_NOTICES.md、docs/decisions.md、docs/plugins.md、docs/spec/04/09/11、package-lock.json、package.json、packages/cli/src/completion.test.ts | **ARCHIVE（tag）**：25 个新增文件中 11 个与 main 相同、8 个更旧；main 仅缺 `proposals/ai-card/*` 6 个文件（与 card-plugin 重复） |
| archive/private-main | f3d384a 10-20 docs: 完成中英文 README… | 无共同祖先 | 156/371 | 否 | 721 文件 +1579/−100604 | 旧私有镜像（sha 与 remote `archive/main` 相同） | `git merge-tree` 报 refusing to merge unrelated histories | **ARCHIVE（tag）+ 删 archive remote**：独有仅 `patches/pi-durable-1.3.0.patch`(10986B)、`scripts/apply-pi-patch.mjs`、`packages/core/src/runtime/patch.test.ts`、`docs/prompts/builtin.zh-CN.md`；main 已改用 vendored `packages/pi-durable`（无 patches/ 机制） |

## 2. yonder-harness 远端分支（本地已有同名 remote 引用；`gh api` 显示无额外远端独有分支）

| 分支 | HEAD | a/b | 已合入 | 规模 | 用途 | dry-merge vs main | 建议 |
|---|---|---|---|---|---|---|---|
| yonder/proposals-delta | 22f14d1 10-23 docs: 补充目标与压缩设计差异点 | 1/172 | 否，1 非等价 | 1 文件 +21 | 目标/压缩设计差异说明 | **clean** | **MERGE**：已有开着的 PR #59；`proposals/goal-context-time-delta.md` 不在 main |
| yonder/context-keeper-design | b3a680f 10-23 | 1/208 | 否，0 非等价 | 1 文件 +313 | 上下文精简设计 | **clean** | **ALREADY-IN（删）**：`proposals/context-keeper/design.md` 与 main 逐字节相同 |
| yonder/goal-mechanism-design | f299edc 10-23 | 1/208 | 否，0 非等价 | 1 文件 +229 | 目标机制设计 | **clean** | **ALREADY-IN（删）**：`proposals/goal-mechanism/design.md` 与 main 相同 |
| yonder/autonomy-prompt | dd11b8a 10-23 prompt: 自主决策、目标先行、够用就停 | 1/208 | 否，1 非等价 | 6 文件 +76/−12 | Agent 自主性 prompt | 冲突 4：CHANGELOG.md、docs/decisions.md、docs/spec/03-agents.md、packages/core/src/prompt/content.ts | **NEEDS-OWNER**：`Goal first`、`Enough, then stop`、`Act, don't hand off` 等在 main 全树 `git grep` 均为空（确认未合入）；但 main 的 content.ts 已重构（多 265 行），62 行新增需手工重放 |
| yonder/default-agent-peer-binding | fd68568 10-24 feat(core): default to restricted peer bindings for new agents | 1/160 | 否，1 非等价 | 30 文件 +798/−48 | 新 Agent 默认受限 peer 绑定 | 冲突 8：CHANGELOG.md、docs/decisions.md、docs/spec/03-agents.md、09-cli-release.md、packages/cli/src/index.ts、delivery.test.ts… | **MERGE**（需解 docs 冲突）：main 中 `peerBinding` 零命中，是真正未合入的功能；含 `packages/core/src/kernel/peer.ts`(+43) 与 336 行测试 |
| yonder/card-channel-merge | 6c7baa1 10-23 | 4/172 | 否，**0 非等价** | 33 文件 +1585/−17 | 名片渠道接线 | 冲突 19（全为 docs/版本文件） | **ALREADY-IN（删）**：4 个提交全部 patch 等价，main 已有 `plugins/channel-card` |
| release/0.2.26102311 | c02b9c1 10-23 | 1/173 | 否，0 非等价 | 25 文件 +93/−91 | 历史发布分支 | 冲突 25（版本/CHANGELOG） | **ARCHIVE（tag）** |
| yonder/release-0.2.26102312 | dcc325e 10-23 | 1/172 | 否，1 非等价 | 27 文件 +100/−96 | 并入名片渠道的发布分支 | 冲突 27 | **ARCHIVE（tag）**：已被 0.2.26102313+ 与 26102705 覆盖 |
| yonder/trim-overbuilt | d27e273 10-22 | 4/208 | 否，4 非等价 | 82 文件 +18/−**4924** | 撤回过度建设（login operations、progress-observer） | 冲突 15：CHANGELOG.md、docs/decisions.md、docs/spec/08-config.md、docs/status.md、package-lock.json、package.json… | **ARCHIVE（tag）**：撤回目标已自然消失——main 的 `plugins/` 下已无 progress-observer / login operations |
| yonder/trim-overbuilt-r2 | 0866beb 10-23 | 6/176 | 否，6 非等价 | 82 文件 +16/−4932 | 同上，对齐 0.2.26102309 | 冲突 11 | **ARCHIVE（tag）**，同上 |

## 3. yonder-card-web（origin=GoYonderTogether/yonder-web，主线 origin/main）

| 分支 / worktree | HEAD | 基准 | a/b | 已合入 | 规模 | 用途 | dry-merge vs origin/main | 建议 |
|---|---|---|---|---|---|---|---|---|
| zoran/live-dev（主 worktree `/Users/zoran/Documents/yonder-card-web`） | ce3f4d9 10-26 docs: describe full-stack web and documentation map | origin/main | 44/2 | 否，44 非等价 | 240 文件 +8435/−915 | 全栈 live 开发线（server/ + 身份/名片/群/短链） | 冲突 39：server/src/app.ts、auth.ts、cards.ts、chat.ts、devices.ts… | **MERGE**（变基到 origin/main）：唯一活跃开发线，已推 `origin/zoran/live-dev`；冲突集中在 server/ 与 src/App.tsx |
| codex/multidevice-w0-20261026（worktree `…/task/worktrees/yonder-card-multidevice-w0`） | ab456a5 10-26 fix(card): bound relay frames before WebSocket parsing | origin/main | 35/2 | 否，35 非等价 | 187 文件 +7962/−882 | Card 执行中继 W0（可选 relay 传输） | 冲突 39（同 live-dev） | **MERGE**：相对 live-dev 仅 3 个独有提交（ce3cb53 契约文档、513d14a relay transport、ab456a5 帧上限）；**未推送** |
| fix/yonder-web-ui-icons-20261027（worktree `~/.local/share/yonder-harness/home/development/yonder-web-ui-icons-20261027`） | 887769b 10-26 fix(ui): use Lucide return arrow and separate execution from connectivity | live-dev ce3f4d9 | 44/2 | 否，44 非等价 | 238 文件 +8346/−891 | 返回箭头 + 执行/连通分离 | 冲突 39 | **SQUASH-MERGE**：相对 live-dev 只有 1 个提交，cherry-pick 即可；**未推送** |
| main（本地） | 931e84c 10-23 feat: 桌面三栏、通讯录卡包…（0.2.26102301） | origin/main | 3/2 | 否，3 非等价，但 3 提交是 live-dev 的祖先 | 69 文件 +2951/−667 | 早期桌面三栏 | 冲突 11：src/App.tsx、src/components/CardView.tsx(add/add)、Shell.tsx、chat/DeviceRow.tsx(add/add)、wallet/ContactList.tsx(add/add)… | **ALREADY-IN（本地 main 重置到 origin/main）**：内容全部在 live-dev 内 |
| yonder/card-web-takeover-20261023（worktree `/private/tmp/yonder-card-web-takeover-20261023/worktree`） | 7ca4b14 10-23 | origin/main | 0/1 | **是，origin/main 的祖先** | — | 卡包/通讯录/社交导航 | clean | **ALREADY-IN（删分支 + 删 /private/tmp worktree）** |
| task-6/card-w3（detached worktree `/Users/zoran/Documents/Codex/2026-10-26/task-6/card-w3`） | 269e75f 10-26 fix(card): bound relay frames… | ce3cb53 | — | 无分支引用；树与 ab456a5 完全相同 | 与 W0 同 | relay 帧上限 | — | **ALREADY-IN（删 worktree）**：`git diff 269e75f ab456a5` 为空 |
| origin/design/owner-console（远端独有） | 72aa47d 10-24 docs: record owner-console backup decisions and implementation handoff | origin/main | 2/1 | 否，2 非等价 | 3 文件 +396 | owner console 云备份决策 | **clean** | **MERGE** |

未提交：主 worktree 5 个未跟踪文件（`artifacts/avatar-study-2026-10-26/` 下 wallet-browser-debug.json + 4 张 png；该目录已有 20 个文件入库，整目录 8.8M）；4 个 worktree 工作区均 clean。

## 4. /Users/zoran/Documents/Codex/2026-10-26/

| 路径 | 归属 | HEAD | 已合入 | 规模 | 用途 | dry-merge | 建议 |
|---|---|---|---|---|---|---|---|
| task-4/yonder-w1 | harness 的**整份克隆**（origin 指向已不存在的 `…/task/worktrees/yonder-multidevice-w0`，死链） | detached 98763d9 10-26 feat(executor): bind optional persistent Card relay to daemon（本地分支 codex/multidevice-w0-20261026 = 0591eae） | **是**：d8bb080、ac29e39、3896910、98763d9 四个提交 `git cherry main` 全为 `-`（patch 等价） | 10 文件 +2279 | executor：签名设备台账、HTTPS daemon+配对 CLI、daemon 独占/RPC 原子化、Card relay 绑定 | vs harness main：5 个 add/add 冲突 `packages/executor/{README.md,src/cli.ts,src/executor.ts,test/executor.test.ts,test/regressions.test.ts}` | **ALREADY-IN（删检出）**：main 已有同功能且更全（`packages/executor/src/backends/linux*`、`agent-device-worker.ts`、`fence daemon` 修复） |
| task/worktrees/yonder-card-multidevice-w0 | card-web worktree | ab456a5 | 见上表 | — | Card relay W0 | — | 走 §3 的 W0 行 |
| task-6/card-w3 | card-web worktree | 269e75f | 与 ab456a5 同树 | — | — | — | 删 worktree |
| task/、task-2/ | 非 git 仓库 | — | — | md/证据文件 | `multidevice-plan.md`、`integration-progress.md`、`w0-*-evidence.json`、`multidevice-admission-review.md` | — | 保留为证据；task-3/5/7 是空目录 |

## 5. pi fork（实为**一个仓库 + 6 个 worktree**，见 §a）

主线 `yonder/1.3`；vendored 基线 = 45014f2（= `integration/t61-t63`，见 `packages/pi-durable/FORK_SOURCE.json`）。

| 分支 | HEAD | 在 vendored 45014f2 内？ | 在 origin/yonder/1.3 内？ | 差异 | 建议 |
|---|---|---|---|---|---|
| integration/t61-t63 | 45014f2 10-26 docs: identify required matching pi-ai artifact | 即基线本身 | **否** | 4 提交未推送（a1597be 观测、c84f8e6 显式凭据、48a5051 abort 顺序、45014f2 文档） | **MERGE→push**：这是 T61/T63 唯一权威版本，只在本地 |
| fix/hosted-local-exec-20261025 | 9060e7f 10-25 | 是 | 是（PR #1） | 0 | **ALREADY-IN** |
| obs/t61-first-batch | 1e7752d 10-26 | 否（提交本身），但**树与 a1597be 完全相同**，a1597be 在基线内 | 否 | vs 基线 1 ahead/4 behind，`git cherry` = 0 非等价 | **ALREADY-IN（删）**：旧快照，已被 a1597be+48a5051 取代 |
| sol/t63-slots | b9e6dfc 10-26 | 否（提交本身）；父提交 9060e7f，是 c84f8e6 的旧快照，c84f8e6 在基线内且多 1577 行测试 | 否 | vs 基线 1 ahead/4 behind，1 非等价 | **ALREADY-IN（删）**：被 c84f8e6 取代 |
| yonder/1.3（本地） | eca1f25 10-20 | 是 | 是 | 落后远端 10 | 重置到 origin/yonder/1.3 |
| zoran/compact-recovery | f263794 10-23 | 是 | 是 | 0 | **ALREADY-IN** |
| zoran/input-queue-interrupt | 5bba5ae 10-21 | 是 | 是 | 0 | **ALREADY-IN** |
| zoran/model-fallback | 25f0239 10-23 | 是 | 是 | 0 | **ALREADY-IN** |
| zoran/tool-loading-recovery | 59cfaf0 10-23 | 是 | 是 | 0 | **ALREADY-IN** |
| zoran/tool-search-relevance | 25f0239（与 model-fallback **同一 sha**，落后 4） | 是 | 是 | 0 | **ALREADY-IN（删重复指针）** |

vendored 校验：45014f2 的 `packages/durable`（209 文件）对 harness `packages/pi-durable` → 86 个逐字节相同、`README.md` 与 `package.json` 已改写、**117 个 test 文件 + 3 个 vitest/tsconfig 未 vendored**。

## 6. yonder-hermes-extensions（本地，无 remote）

单分支 `main` @84def0e（10-27 Merge branch 'feat/hermes-learning-parity-20261025'），13 提交，工作区 clean，无 tag、无 stash → **无未合并工作**。建议：**NEEDS-OWNER** — 推一个 private remote 做备份（当前零备份）。

## 7. 未提交 / 暂存清单

**harness 工作区（5 改 + 4 未跟踪）**
- `packages/core/src/runtime/model-chain.ts`（8 行）：链路顺序改为 primary → 首个 fallback 模型（WorkBuddy）→ 其他账号（GPT2）→ 其余
- `packages/core/src/runtime/model-chain.test.ts`（8 行）：断言随之改为"首个 fallback 模型先于其他账号"
- `packages/core/src/runtime/model-watch.ts`（4 行）：探针 `maxTokens: 8 → 512`，避免推理模型空完成导致健康 key 永远无法解除 hold
- `proposals/local-model-gateway.md`（+191/−94）：本机模型网关提案改写
- `.workbuddy-ai/memory/2026-10-27.md`（+98/−2）：当日工作日志
- 未跟踪：`.codegraph/`（49M，**未被 .gitignore 忽略**）、`packages/core/src/runtime/model-chain.ts.bak-order-20261027`、`proposals/unified-client/`（design.md + research/，160K）、`proposals/workbuddy-hub-integration.md`（149 行）

**harness stash（2 条）**
- `stash@{0}` 2026-10-23 On yonder/card-plugin: preserve card edits while merging unified status UI（8 文件 +81/−12）：内容 **100% 已在其父分支 yonder/card-plugin** 内（decisions.md/plugins.md/status.md/CHANGELOG.md 逐行命中）→ 可安全 drop
- `stash@{1}` 2026-10-21 On yonder/feishu-live-status: pr4-11368-preserve-sealed-original-before-reviewed-fast-forward（6 文件 +341/−62）：主仓已无 `yonder/feishu-live-status` 引用（411cf87 对象仍在）；内容约 97% 已在 main（task-card.ts 110/113、task-card.test.ts 103/106、contract.test.ts 32/32）→ drop 前人工核对 `plugins/channel-feishu/src/index.ts` 的 3 行差异（`taskCardParameters` 抽取）

**card-web**：5 个未跟踪（见 §3）；无 stash。**pi / Codex 各检出 / hermes-extensions**：无未提交、无 stash。

## (a) 应合并的重复检出

1. **四个 pi 目录不是四份克隆**：`/Users/zoran/Documents/github/yonder-pi` 是唯一主仓（且是 **shallow clone**，`.git/shallow` 存在），`yonder-pi-compact-recovery`、`yonder-pi-fallback`、`yonder-pi-tool-discovery` 都是它的 `git worktree`；另外 `/private/tmp/{t61-pi,yonder-integration-pi,yonder-t63-pi}` 也是同一仓库的 worktree。分支 sha 四份完全一致 → 无需合并对象库，只需 `git worktree remove` 掉 `/private/tmp` 三个和已合入的两个 Documents worktree。
2. **card-w3 与 W0 同树**：`/Users/zoran/Documents/Codex/2026-10-26/task-6/card-w3` 的 269e75f 与 `codex/multidevice-w0-20261026` 的 ab456a5 树相同 → 删 worktree，保留分支。
3. **task-4/yonder-w1 是 harness 的整份克隆**（含 node_modules），其 origin 指向已删除的 worktree 路径；4 个提交在 main 中已 patch 等价 → 可直接删除整份检出。
4. **harness `archive` remote 冗余**：`archive/main` = f3d384a = 本地 `archive/private-main`，等于第二份旧镜像 → 打 tag 后删 remote。
5. **pi 两个分支指针重复**：`zoran/tool-search-relevance` 与 `zoran/model-fallback` 指向同一 sha 25f0239。

## (b) 建议合并顺序（含依赖）

1. **card-web**：`zoran/live-dev` 变基到 `origin/main`（44/2，39 冲突集中在 `server/src/*`），推 `origin/zoran/live-dev`。
2. **card-web**：cherry-pick 887769b（ui-icons，1 提交）到 live-dev。
3. **card-web**：cherry-pick ce3cb53 + 513d14a + ab456a5（relay W0）到 live-dev。**依赖**：harness 侧 executor 已具备 `packages/executor/src/card-connection.ts`（main 的 eef9f51 / 246961e 已合），故 harness 无需再动，Card 侧先落地即可对接。
4. **card-web**：合 `origin/design/owner-console`（clean，3 文件）。
5. **harness**：先合 **PR #59** `yonder/proposals-delta`（clean，纯文档，零风险）。
6. **harness**：`yonder/default-agent-peer-binding`（30 文件 +798，含 `kernel/peer.ts`；先解 docs/spec/03-agents.md、09-cli-release.md 冲突）。
7. **harness**：`yonder/runtime-discipline` 变基重放（依赖 main 已重构的 runtime/delivery，冲突 10 文件，含 2 个全新文件）。
8. **harness**：`yonder/autonomy-prompt` 的 prompt 段落手工重放到现 content.ts（不能直接 merge）。
9. **harness**：从 `yonder/card-plugin` 只捞 `brand/assets/**`、`brand/scripts/build.mjs`、`proposals/ai-card/*`、`proposals/card-studio/*`（31 文件）。
10. **pi**：把 `integration/t61-t63`（45014f2，4 提交）推到 GoYonderTogether/pi 的 `yonder/1.3`；随后同步 harness `packages/pi-durable`（当前 FORK_SOURCE 已钉 45014f2，一致）。
11. 打 tag 归档：`archive/pre-rightapi-20261021`、`archive/private-main-20261020`、`archive/card-plugin-20261027`、`archive/trim-overbuilt-20261022`、`archive/release-0.2.26102311/12`；然后删已 ALREADY-IN 的 8 个分支。

## (c) 风险

- **只存在本地、无远端备份**：card-web 的 `codex/multidevice-w0-20261026` 与 `fix/yonder-web-ui-icons-20261027`（远端只有 main / zoran/live-dev / design/owner-console）；pi 的 T61/T63 四个提交（45014f2、48a5051、c84f8e6、a1597be，且主仓是 shallow clone）；`yonder-hermes-extensions` 完全没有 remote。
- **harness 未跟踪的生成物/备份文件**：`.codegraph/`（49M，未进 .gitignore）、`packages/core/src/runtime/model-chain.ts.bak-order-20261027` → 提交前必须排除，否则 49M 二进制索引进 main。
- **card-web 已入库的验证截图**：`artifacts/avatar-study-2026-10-26/` 已有 20 个文件入库（整目录 8.8M），另有 5 个未跟踪。
- **可能含敏感数据的文件（仅列名，未读值）**：`artifacts/avatar-study-2026-10-26/wallet-browser-debug.json`（430K 浏览器调试转储，可能含 cookie/token/localStorage）；`fresh-runtime-presence.json`、`live-export-bundle-check.json`、`renderer-cors-check.json`；harness 改动中的 `proposals/local-model-gateway.md` 与 `.workbuddy-ai/memory/2026-10-27.md` 涉及 provider/账号描述，提交前确认无明文 key。
- **本地 main 与 origin/main 不同步**（card-web：本地 main 3/2，且其 3 提交只在 live-dev 里；harness 两个 archive 分支含义不同，一个是镜像一个是快照）→ 易误判"已合入"。
- **未核实**：`stash@{1}` 那 3 行差异是否已无价值；`yonder/runtime-discipline` 的代码部分是否已被 main 完全超车（main 侧 delivery/index.ts 反而多 202 行，方向需人工比对）；`yonder/card-plugin` 中 25 个"不同"文件中 ui-companion/channel-wechat-ilink 的最新意图归谁（分支 10-23 提交 vs main 10-23 提交，语义需 owner 判断）。