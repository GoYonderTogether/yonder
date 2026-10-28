# CH-06 投递复核切片（2026-10-28）

启用 social 的源会话回复在 send、重试和流的每个输出前检查当前渠道范围及社交策略；静默、quiet、拒绝或取消授权后停止继续发送。热重载原位更新 agents Map，已有会话继续使用固定 profile。已交给渠道的内容无法撤回；没有来源事件的主动发送不在本切片内。

定向验证：`npx vitest run packages/core/src/delivery/delivery.test.ts`：1 文件通过，33 测试通过、0 失败、0 跳过，含静默、流中撤权和重试测试。`npx biome check` 检查本切片 4 个 TypeScript 文件退出 0，24 warnings。`node scripts/check-file-size.mjs` 失败：并行修改的 routing/index.ts 522 行，新超限；本切片 delivery/index.ts 未超基线。`npx tsc -b` 失败：kernel/index.ts 引用缺失的 projectRulesFor，code-intel/diagnostic-mark.ts 两处 string | undefined；均非本切片修改。

整卡未完成：social_inspect/update/resume、策略更新与持久化、控制面、可信 actor/sourceEvent 审计、权限矩阵、真实模型和真实渠道均未实现或未验证。上述测试为进程内渠道测试，不是实际平台证据。

## 第三轮最小切片（2026-10-28）

已接入 `social_inspect` / `social_update`：按已记录消息识别群、私聊或频道，私聊按授权账号/person 判断；主人私聊预览后需在同会话单独回复“确认”，才可按相同参数应用。目标策略写入 agent.yaml 并热重载，更新成功和进入服务后的拒绝追加审计。控制面、事件 golden 及真实模型验收见后续补充。

`npx tsc -b packages/core plugins/social` 通过；`npx vitest run packages/core/src/kernel/social.test.ts plugins/social/test/batches.test.ts --exclude 'apps/desktop/**'`：2 文件、6 测试通过，0 失败、0 跳过。先前包含 routing 的运行：2 文件失败、2 通过；1 个测试因临时尝试改变 mention 语义失败，改动已撤回；desktop 构建副本缺 tsconfig 导致另一文件加载失败。Biome 定向检查退出 0，原有警告及少量非空断言警告。

未完成：跨渠道 person 全局覆盖、已有映射调整、resume、非本地工作区原子更新、控制面入口前权限拒绝审计；无已记录目标消息时拒绝。真实模型与真实渠道尚未验证，不能将上述测试视为渠道验收。

控制面前置拒绝补充：`social.update` 在方法权限或参数校验阶段被拒时，也追加 `social.policy-change`；记录认证后的 principal、拒绝类别及可验证格式的目标，不记录未经校验的请求正文。HTTP、WebSocket 订阅入口和 control.sock 均复用该校验。`npx tsc -b packages/core packages/gateway` 通过；定向 vitest 3 文件、4 测试通过、0 失败/跳过；Biome 定向检查通过，2 条既有非空断言警告。本次未启动真实 gateway；网络端到端验收未测。

## CH-06r3 真实模型验收（2026-10-28）

干净池副本 `d3a7e8a` 构建通过，包含 `341de3d`、`773c30a`、`aad0779`；不含之后的 `d817ed5`。在独立 HOME 启用 social，使用进程内测试渠道创建已授权群 `conv:ch06:group` 的 `message.in`，初始策略为 record。SiliconFlow `deepseek-ai/DeepSeek-V3.2` 通过 `real-check.sh` 先检查并预览改为 mention，要求主人另发确认；第二次单独发送“确认”后模型应用修改，两轮分别耗时 42.2 秒和 26.6 秒。

控制面 `social.inspect` 读回 `mode: mention`、`signals.botMention: respond`；`social.policy-change` 记录 `acct:console:owner`、确认消息 sourceEvent、record 到 mention 的 before/after、revision 及 applied。重启独立服务后，进程内渠道发送未提及和提及机器人两条消息，路由事实分别为 `mention`、`bot-mention`，revision 与控制面一致。服务已停止；这是进程内渠道和真实模型证据，未验证实际平台群消息或外部送达。

验收使用 `verify-copy.sh` 和 `real-check.sh`；由于原 `verify-home.sh` 强制读取并复制额外的 gw 凭据槽及设置回退，与本卡仅导入 siliconflow 的要求冲突，使用其临时副本移除 gw 读取和回退，其余启动流程不变。后续 `d817ed5` 的真实模型验收未重复。
