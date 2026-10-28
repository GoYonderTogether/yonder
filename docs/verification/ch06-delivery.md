# CH-06 投递复核切片（2026-10-28）

启用 social 的源会话回复在 send、重试和流的每个输出前检查当前渠道范围及社交策略；静默、quiet、拒绝或取消授权后停止继续发送。热重载原位更新 agents Map，已有会话继续使用固定 profile。已交给渠道的内容无法撤回；没有来源事件的主动发送不在本切片内。

定向验证：`npx vitest run packages/core/src/delivery/delivery.test.ts`：1 文件通过，33 测试通过、0 失败、0 跳过，含静默、流中撤权和重试测试。`npx biome check` 检查本切片 4 个 TypeScript 文件退出 0，24 warnings。`node scripts/check-file-size.mjs` 失败：并行修改的 routing/index.ts 522 行，新超限；本切片 delivery/index.ts 未超基线。`npx tsc -b` 失败：kernel/index.ts 引用缺失的 projectRulesFor，code-intel/diagnostic-mark.ts 两处 string | undefined；均非本切片修改。

整卡未完成：social_inspect/update/resume、策略更新与持久化、控制面、可信 actor/sourceEvent 审计、权限矩阵、真实模型和真实渠道均未实现或未验证。上述测试为进程内渠道测试，不是实际平台证据。

## 第三轮最小切片（2026-10-28）

已接入 `social_inspect` / `social_update`：按已记录消息识别群、私聊或频道，私聊按授权账号/person 判断；主人私聊预览后需在同会话单独回复“确认”，才可按相同参数应用。目标策略写入 agent.yaml 并热重载，更新成功和进入服务后的拒绝追加审计。控制面、事件 golden 及真实模型验收见后续补充。

`npx tsc -b packages/core plugins/social` 通过；`npx vitest run packages/core/src/kernel/social.test.ts plugins/social/test/batches.test.ts --exclude 'apps/desktop/**'`：2 文件、6 测试通过，0 失败、0 跳过。先前包含 routing 的运行：2 文件失败、2 通过；1 个测试因临时尝试改变 mention 语义失败，改动已撤回；desktop 构建副本缺 tsconfig 导致另一文件加载失败。Biome 定向检查退出 0，原有警告及少量非空断言警告。

未完成：跨渠道 person 全局覆盖、已有映射调整、resume、非本地工作区原子更新、控制面入口前权限拒绝审计；无已记录目标消息时拒绝。真实模型与真实渠道尚未验证，不能将上述测试视为渠道验收。

控制面前置拒绝补充：`social.update` 在方法权限或参数校验阶段被拒时，也追加 `social.policy-change`；记录认证后的 principal、拒绝类别及可验证格式的目标，不记录未经校验的请求正文。HTTP、WebSocket 订阅入口和 control.sock 均复用该校验。`npx tsc -b packages/core packages/gateway` 通过；定向 vitest 3 文件、4 测试通过、0 失败/跳过；Biome 定向检查通过，2 条既有非空断言警告。本次未启动真实 gateway；网络端到端验收未测。
