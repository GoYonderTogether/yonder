# R2 A：GitHub 与更新修复结果

日期：2026-10-18。基线 R0 `ae60bf2`，同 checkout 由主 agent统一提交；本路仅改 `plugins/channel-github/**` 和本文件，未切分支/暂存/提交。

## 变更

- I10：独立 runner 通过安装 CLI 的 `service info --home <home> --json` 获取真正运行服务的 version/commit/home/pid/ready，与磁盘安装来源、origin commit/tag/repository 和 launchd status 交叉核对。更新前也核对安装目录/运行来源；更新后有限等待 ready，旧版本进程、新 PID 未就绪、错误 commit/home 都不能 verified。保留失败证据，旧版本由原安装器保留，回滚仍显式 `update --to`；删除 README 自动回滚声明。
- I11：本次目录创建后，request/copy/plist/取消的准备错误在 bootstrap 调用前清理本次暂存；调用 bootstrap 后错误保留未知状态，同 release 查询原作业，不自动重发，无终态时阻止其他 release。
- I12：评论工具经 `api.messages.send(request, ctx)` 保留真实上下文及共同发送回执；不把 uncertain 收据压成普通异常。渠道发送一律保留自身状态 marker；POST 调用后丢失结果返回 uncertain，写入前的拒绝不记不确定。
- D4：首次成功读取列表保存所有已有 release id（含当时不获准/draft）为基线，不发历史事件；基线保存失败不能继续接纳。其后仅接纳新获准正式发布；逐项游标在落盘成功后更新内存。
- 生产调用点：`src/index.ts`、`channel.ts`、`releases.ts`、`updates.ts`、`update-job.ts`。未加依赖、第二更新器、自动重试或自动回滚。

## 实际检查

- `npx vitest run plugins/channel-github/test/repair.test.ts`：最终 **1 文件通过，20 tests passed，0 failed/skipped**。覆盖 REST 分页；同秒水位、重启去重；账号/标签/自评论/PR-as-issue；PR patch 缺失/pending checks；Release 基线、读取失败/持久化失败；共同评论 ToolContext/不确定结果；准备失败、派发前取消、bootstrap 未知及重复调度；真实服务证据匹配/不匹配。
- 检查只用临时目录、协议对象及拦截的客户端/进程边界；不包含模拟模型，不联网、不调用真实 launchd、不读取凭据或日用 home。它证明本地逻辑与协议映射，不是 GitHub/安装验收。
- 保留过程结果：首批17/17通过；补齐后20/20通过。更正检查用评论 id 使其跨 issue 唯一时，旧期望未同步造成一次19 passed/1 failed，随后同步期望并最终20/20通过；未改弱断言。
- `npx biome check plugins/channel-github/src plugins/channel-github/test --diagnostic-level=error`：7 files，0 errors。默认级别仍有既有/测试的可选 lint warning（如 non-null assertion）；没有 suppress 配置。
- `npx tsc -b plugins/channel-github --pretty false`：首次失败 **1 个 TS2554**，SDK `messages.send` 尚只声明单参数；主 agent负责加入可选 ToolContext 并统一构建后复验。其余生产文件无类型错误。

## 问题与未测

- 共享依赖：主 agent的 SDK `messages.send(request, ctx?: ToolContext)`、`Delivery.uncertain?: boolean` 和 CLI `service info` 需进入同一候选；runner 期待该命令直出 `{version,commit,home,pid,ready}` JSON 对象。
- 未执行真实授权、GitHub issue/PR/Release、真实 launchd 更新、安装/服务重启、模型输入与通知送达。按 R4/R5 保留验收义务；本路成果由 Codex sub agent完成，不记 Yonder 自主开发。
- 没有实质设计空白；安装失败后的旧版本保留与显式回滚，仍由原更新入口负责。
