# pi-durable 内化与恢复验收（2026-10-20）

起点：`yonder/interrupt-recovery` / `3bcacb5`。本地分支：`yonder/pi-fork`，未推送本仓库。

## 来源与改动

Fork：https://github.com/GoYonderTogether/pi/tree/yonder/1.3/packages/durable

基于上游 `v1.3.0` / `71023aec1546d6d677a65669c5665c0927ce0dd0`。已推送的 fork HEAD：`eca1f259bb08f4fa14a96b93b456e4684fe3c450`。

| Fork 提交 | 内容 |
|---|---|
| `2c9f66e` | D28：beforeAgent、单运行 abort 后 final boundary 接续队列 |
| `9e499c7` | D29：终结事务保存 inputs、settlement、结束 usage |
| `c97f722` | D44：shouldRetry、耗尽错误；新增真实本地 HTTP 测试 |
| `7cab3f3` | 更新上游 inbox / compaction 的旧 abort 断言，保持完整 final-boundary 契约 |
| `eca1f25` | FORK.md 说明测试差异 |

本仓库功能提交：`5dba617`（vendor、构建/锁文件/同步工具/规范）、`e3f7560`（配置、通知、终结与关闭逻辑、真实恢复检查）。验收记录为后续纯文档提交。所有提交包含任务指定的 Co-Authored-By。

主要文件：`packages/pi-durable/`（完整 src、MIT LICENSE、README、CHANGELOG、FORK、来源 JSON），`scripts/sync-pi-durable.mjs`，根 package/lock/tsconfig 与 SDK/core references，`runtime/fork.test.ts`，`runtime/recovery.ts` / `index.ts` / `docs.ts` / `recovery.test.ts`，`config/schema.ts` / `config.test.ts`。删除 patches、apply-pi-patch 与根 postinstall。文档同步 spec/07、08、10，D28/D29/D44、CONTRIBUTING、THIRD_PARTY_NOTICES、status、CHANGELOG。

## 最终验证

| 检查 | 文件原始计数 | 用例原始计数 |
|---|---|---|
| 本仓库 `npm run build && npm run typecheck && npm test && npx biome check . --diagnostic-level=error` | 51 通过 / 8 跳过 / 0 失败（59） | 182 通过 / 16 跳过 / 0 失败（198） |
| 随后 `YONDER_TEST_REAL=1 npx vitest run --exclude '**/dist/**'` | 59 通过 / 0 失败 | 197 通过 / 1 跳过 / 0 失败（198） |
| 全新本地 clone：`npm ci && npm run build && npm test` | 51 通过 / 8 跳过 / 0 失败（59） | 182 通过 / 16 跳过 / 0 失败（198） |
| Fork durable harness 相关测试（含新 yonder-fork.test.ts） | 31 通过 / 0 失败 | 619 通过 / 0 跳过 / 0 失败 |
| 同一组 fork 测试，`PI_DURABLE_DOCUMENT_RETENTION_MS=0` | 31 通过 / 0 失败 | 619 通过 / 0 跳过 / 0 失败 |

无取消用例。真实全量唯一跳过项需要 launchd。默认跳过项需要模型，不能算通过。

干净克隆位于 `/tmp/yonder-pi-clean-clone`，由 `git clone --no-hardlinks --branch yonder/pi-fork /Users/zoran/Documents/yonder-harness /tmp/yonder-pi-clean-clone` 创建，测试代码提交为 `e3f75600aacb2aba874201083a7a93b197f1671b`；没有拷贝 node_modules、dist 或凭据。原工作区和该克隆的 `npm ci --dry-run` 均 exit 0。npm 提示 3 个上游依赖生命周期脚本尚未加入 allowScripts；命令本身成功，没有根 postinstall 补丁。克隆安装审计 0 vulnerabilities。

依赖树确认 durable 只有指向 workspace 的一份；pi-ai、chord、codemode、coding-agent 等继续使用 npm 1.3.0。vendor src 与 fork checkout 逐文件比较无差异。同步工具实际从 fork 分支刷新并记录最终完整 commit。

真实恢复检查涵盖：在途请求连续重启两次只注入一条重启提示；完成工具后 501/503 连续失败不重复副作用或来源投递；ECONNRESET 类 socket 断开、429、500/501/502/504/529 重试；auth/API key/permission、schema/invalid request、context/token limit、quota/billing、abort/repeatStop 不重试；耗尽正常 error、没有 pending work；退避立即 abort；退避期间反复重启保留次数且共享提示；耗尽后再重启两次没有新请求或提示。真实 repeatStop 工具终止由 limits.test.ts 一并验收。失败注入使用实际本地 HTTP provider 端点，不新增模拟模型。Fork 新测试同样使用真实 HTTP，并验证 300 秒 backoff 中的单运行取消及 successor、最大延迟映射和原子错误/中止回执。

## 原始失败与修复记录

以下为本轮原始计数，保留失败，不用最终通过覆盖；父分支历史记录继续保留在 status。

| 执行 | 原始结果 | 原因及处理 |
|---|---|---|
| Fork 初次 4 文件定向 | 4 文件加载失败，0 用例运行 | pi-ai 尚未构建；补齐模型目录并构建依赖 |
| Fork 同组定向 | 4 文件 / 45 用例通过 | D28/D29 基础检查 |
| Fork 增加新测试后（两次相同结果） | 2 文件失败 / 3 通过；4 用例失败 / 44 通过 | 测试误用 register/DocumentReader.conversation；耗尽详情断言仍为旧值；第二次因编辑脚本工作目录错误重复同一失败。改用真实 API 与准确详情 |
| Fork 后续定向 | 1 文件失败 / 4 通过；3 用例失败 / 45 通过 | 回执仅含 settlement 而非整份 submission；单运行取消应使用 abortTask，不是取消整个 conversation。修正测试边界 |
| Fork 最后定向 | 5 文件 / 48 用例通过 | 上述问题修复 |
| Fork 扩大到 harness 相关组 | 2 文件失败 / 29 通过；3 用例失败 / 616 通过 | 原上游断言期待 abort 不处理 inbox/summary，与批准的 D28 final boundary 冲突；改为断言 summary 已落位、follow-up 已接续，新的 HTTP 测试同时确认 successor |
| Fork 修正后与 retention=0 | 两次均 31 文件 / 619 用例通过 | 最终来源测试 |
| Yonder 初次定向 | 3 文件通过；4 用例通过 / 3 跳过 | 默认不开模型 |
| Yonder 初次真实定向 | 2 文件 / 6 用例通过 | HTTP 恢复与真实 limits |
| Yonder 首次全量默认 | 2 文件失败 / 49 通过 / 8 跳过；3 用例失败 / 179 通过 / 16 跳过（198） | 把全部错误 detail 拼入 reason 扩大了契约；收窄为仅重试耗尽保留说明，其余 reason 不变 |
| 同期首次真实全量 | 2 文件失败 / 57 通过；3 用例失败 / 194 通过 / 1 跳过（198） | 已启动的检查仍加载了上述旧代码；同一原因 |
| 同步与构建误重叠的一轮 | 24 文件失败 / 35 通过；6 用例失败 / 148 通过 / 1 跳过（155），其余未加载 | 执行失误：同步删除 dist 与构建并发，导致多个 suite 加载失败及其他失败；不是有效功能验收。等待同步完成，按顺序重新 build/typecheck/test/lint |
| 随后完整默认、真实全量、干净克隆 | 最终计数见上表 | 全部范围内缺陷已修复 |

Fork 构建曾因模型目录缺失退出；hydrate 后有 2 个新增回执 copyJson 类型错误，改为准确的 Draft 类型后 durable build 通过。同步工具首次用缩写 SHA fetch 失败，没有替换 vendor；文档明确使用分支或完整 SHA，后续分支同步成功。

Fork 根 `npm run check` 初次因模型目录未准备产生 1056 个 TypeScript 诊断；目录准备后还存在 39 个 pi-ai 测试的旧 `mimo-v2.5-pro` 模型名类型错误。一次中间检查为 41 个（包含新增测试的 2 个 API 类型错误，已修）；最后仍为 39 个且均不在 durable。Biome、固定依赖、runtime imports、TS import 路径、entry graphs、coding-agent install-lock 检查通过；根检查在 TypeScript 阶段退出，browser-smoke 未运行。未修改 pi-ai 或其他包来消除上游目录问题，不能把 fork 根全仓 check 记为通过。durable build、上述 619 用例及本仓库全部必需检查通过。

## choices I made

- `retry` 为 harness 级配置，延续 yonder.yaml 其余设置的重启生效规则；各字段可单独省略，maxRetries=0 禁用，延迟使用正整数毫秒并限定 Node timer 范围。
- 直接映射 pi-ai 已有的 `maxAgentDelayMs`，不增加 durable cap API，不 fork pi-ai；指数退避不加随机抖动。
- 恢复保留 checkpoint 中已经消耗的次数和当前截止时间；后续退避使用重启后的配置。连续失败及其间重启沿用同一中断标记；已终结运行不注入提示。
- 耗尽维持正常 error 和 model_error 归类，只为耗尽 reason 携带计数与最后错误，避免扩大其他原生错误契约。
- vendor 保留全部源码和公开 subpath，含公开 `/testing` 所需辅助代码；上游测试/bench 执行脚本和大型 fixtures 留在 fork。只转换 workspace 构建元数据，第三方源码沿用上游编译语义与 Biome；本仓库 Biome 排除 vendor。

## 未验证与边界

未执行真实系统关机、正式 yonder update、飞书客户端恢复、生产 home/服务或 launchd 生命周期；未等待一次完整的默认 10 次、最高 5 分钟退避序列。实际计时覆盖 2 秒起的恢复、较短配置的增长/封顶，以及 300 秒待退避中的立即取消。供应商缓存命中不作保证。没有本仓库 push/merge/tag/release，没有覆盖安装；保留用户已有未跟踪提示词目录。
