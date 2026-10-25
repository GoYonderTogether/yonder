# 任务账本发布候选 0.2.26102507（2026-10-25）

仅在 `/Users/zoran/Documents/yonder-harness-tasks`、`feat/task-ledger-20261025` 工作。未推送、打 tag、开 PR、发布、安装或操作生产 home/已安装服务。模型凭据仅由测试运行时使用指定 auth 文件，不输出内容。

## 合并

`agent-network run -- git fetch origin` 后合入 `origin/main` 的 `78ae9de`（PR #74、#75、#76），合并提交 `fcc176a`，不改写历史。

- `CHANGELOG.md`：保留本分支 Unreleased 条目及 main 的 .04/.05/.06 发布记录。
- `docs/decisions.md`：仅拼接两侧已批准决定，无新增设计。`docs/status.md`：保留两侧历史原始结果。
- `plugins/ui-companion/web/{app.js,index.html,style.css}`：同一 header 保留看板、图钉、历史与关闭按钮；同一滚动容器保留 Agent 概览和看板视图，CSS 两侧保留。合并状态上报使用交互或看板待办；空闲原生页显示 main 的 Agent 概览，看板显式打开并在当前看板刷新时保留。activity 更新不覆盖看板；现有 Chrome 回归增加该断言。
- 原生 `Companion.swift`、`YonderStatus.swift`、service.ts、README、channel scope、permissions API 自动合并；未删减 main 的行为。package/lock/tsconfig 自动合并，新增 tasks workspace 在安装前对齐 .06 的 SDK 版本。

## 发布元数据

查阅 `git log --oneline --grep '^release:' -5`、最新 `9229047` 完整发布 diff、`docs/spec/09-cli-release.md`、`CONTRIBUTING.md`。main 为 .06，下一版本选 .07；沿用既有发布方式对齐根包、第一方 workspace、内部 @yonder 依赖及锁文件。pi-durable 和第三方依赖版本不变。保留空 Unreleased，将任务条目移入 `0.2.26102507`。

## 检查

以下命令均在指定 worktree 执行；网络命令使用 agent-network 的进程级代理。

| 命令 | 结果 |
|---|---|
| `agent-network run -- git fetch origin` | exit 0 |
| `git merge --no-commit origin/main` | 6 文件冲突，按上文解决后提交 |
| `agent-network run -- npm ci` | 合并后 exit 0；tasks lock 对齐后重复一次 exit 0；.07 metadata 后 exit 0 |
| `agent-network run -- npm run build` | 合并后与 .07 均 exit 0，含 Swift、power helper 自检、helper 构建/签名验证和 companion HTML |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0；0 errors / 478 warnings / 14 infos |
| `npm test` | 114 文件通过 / 0 失败 / 19 跳过；681 用例通过 / 0 失败 / 39 跳过（720） |

默认全量含真实 headless Chrome 看板协议/DOM 回归。以上检查针对合并后的最终代码；后续发布只改版本元数据与文档，.07 额外执行干净安装及构建。

真实检查命令：

```sh
YONDER_TEST_REAL=1 YONDER_TEST_AUTH=/Users/zoran/Documents/yonder-harness/.yonder/auth.json agent-network run -- npm test -- plugins/tasks/test packages/core/src/runtime packages/core/src/kernel packages/core/src/sessions packages/core/src/tools packages/core/src/prompt packages/core/src/plugins
```

第一轮因执行者在仍运行时做 .07 的 `npm ci`，worker 报 `Cannot find module .../vitest/suppress-warnings.cjs`；主动中止 exit 130。该轮没有最终用例计数，不能算通过，也不能从缺失的汇总推断 0 失败。安装/构建结束后以完全相同命令重跑，结果见下方最终记录。无产品代码修正。

真实检查完整重跑：exit 1，48 文件通过 / 1 失败 / 1 跳过；141 用例通过 / 1 失败 / 1 跳过（143）。失败为 `packages/core/src/prompt/task-presets-live.test.ts:70`：120 秒内未取得 coding 子任务的实际脚本计数结果。原始证据 `/tmp/yonder-task-presets-live-pJhfz4/evidence.json` 显示，子任务只调用 task_run，随后明确报告无文件/Shell 工具，未生成脚本。测试将父预设的 offer 限定为 task_run、search=[]，而现有 presetProfile 在子预设未指定 tools 时继承父列表。

`git diff --quiet origin/main HEAD -- packages/core/src/config/index.ts packages/core/src/prompt/task-presets-live.test.ts plugins/agent-presets/src/index.ts` 返回 0；继承逻辑来源 `2d2db39` 已在 origin/main。根据源码和实际转录，这是既有测试配置与继承契约不匹配，不是冲突解决丢失代码；未另开 main 运行模型，不声称 main 已实测复现。按本次范围不改该测试/继承契约，不放宽断言、不延长超时。该失败保留为候选已知未通过项。

唯一跳过：`packages/core/src/kernel/execution-live.test.ts` 固定读取 worktree 的 `.yonder/auth.json`，不使用 YONDER_TEST_AUTH；该文件不存在，本轮 **not tested**，没有复制凭据或改测试绕过。

原始命令日志保留于 `/tmp/yonder-tasks-{ci,ci-final,release-ci,build,release-build,typecheck,lint,default,real,real-final}.log`。默认全量与真实专项的通过数不是同一集合，不能相加当作唯一测试数。

任务插件真实用例另以 `YONDER_TEST_REAL=1 YONDER_TEST_AUTH=/Users/zoran/Documents/yonder-harness/.yonder/auth.json agent-network run -- npm test -- plugins/tasks/test/moments.test.ts --reporter=verbose` 明确核验：1 文件、4 通过 / 0 失败 / 0 跳过；真实 Luna 调用 read、tasks_update，将缺失输入的任务标为 blocked，run.end=done。日志 `/tmp/yonder-tasks-real-moments.log`。该定点结果不覆盖上面的预设失败。

## 隔离 smoke

临时 home `/tmp/yonder-task-ledger-rc-smoke`，使用构建后的 CLI；`desktop:false`，不启动原生状态栏或已安装服务。

```sh
node packages/cli/dist/index.js init /tmp/yonder-task-ledger-rc-smoke --isolated --json
agent-network run -- node packages/cli/dist/index.js start --home /tmp/yonder-task-ledger-rc-smoke --json
node packages/cli/dist/index.js service info --home /tmp/yonder-task-ledger-rc-smoke --json
node packages/cli/dist/index.js inspect --agent main --profile owner --home /tmp/yonder-task-ledger-rc-smoke --json
printf '%s\n' 'Run this isolated release smoke in order: call tasks_open with title "Release candidate smoke", objective "Verify the real loaded tasks plugin and companion page", acceptance ["tasks_list returns the opened task", "companion board page serves"], nonGoals []. Then call tasks_list and verify this task appears. Then call tasks_show with target web. Do not call any other tools. Report the real task ref and URL.' | node packages/cli/dist/index.js chat --preset ledger-smoke --home /tmp/yonder-task-ledger-rc-smoke --json
node /tmp/yonder-task-ledger-browser-smoke.mjs
```

初始化后仅修改临时配置：全局插件加入本 worktree 的 tasks 绝对路径；main.owner 及临时 ledger-smoke 预设选择 `tasks`、`tasks-turn` 和 `tasks_open/tasks_list/tasks_show`。预设使用真实 `openai/gpt-6-luna`，凭据引用用户指定路径。

首次 start 失败 exit 1：临时配置删了 web-tools，但初始化的 research 预设依赖它。恢复初始化的 web-tools 后启动成功；无需产品代码改动。

最终 service.info：version `0.2.26102507`、home 正确、ready=true；开发 checkout 的 commit=null 如实保留。真实模型经真实 loader 完成三次工具调用、均 isError=false：open 返回 T1，list 包含同一 id，show 返回本机 URL。浏览器脚本校验调用顺序/结果、同一 id、页面 HTTP 200、board HTTP 200/含 T1、Chrome 可见看板，以及 Agent 概览/图钉 DOM 同时存在；6 组检查通过 / 0 失败。截图 `/tmp/yonder-task-ledger-rc-board.png` 已目视确认布局，脚本 `/tmp/yonder-task-ledger-browser-smoke.mjs` 保留实际断言。

隔离进程最后通过 `node packages/cli/dist/index.js stop --home /tmp/yonder-task-ledger-rc-smoke --json` 返回 `{ "stopping": true }` 并 exit 0；仅停止本次临时进程，保留 home 与日志供复查。看板 URL 随该进程停止失效。npm ci 报告 4 项既有依赖漏洞（2 moderate / 2 high），未运行 audit fix 或扩大依赖变更。

## 未测

生产 Agent/生产账本对照、真实飞书/QQ/微信投递、已安装状态栏的鼠标/焦点/固定入口交互、真实 TCC 请求/授权继承、物理合盖、电源/安装/升级及正式发布均 **not tested**。默认跳过项不能当通过；真实检查仍跳过的项目单列于最终结果。没有为权限 API 虚构模型/OS E2E。
