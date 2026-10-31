# 内核瘦身：群聊/社交逻辑迁往插件（D 阶段设计稿，待维护者批准接口）

状态：草案。D1 不需要新接口，可直接执行；D2 要新增 SDK 接缝，必须先由维护者批准本页的接口形状并改 04/11/20，才能实现。

## 现状

core 里与群参与、社交、名片相关的非测试代码约 2400 行。逐文件核实（2026-10-31，只读审计）后分三类：

| 文件 | 作用 | 结论 |
|---|---|---|
| `routing/platform-group.ts` 的 `membershipGroup` / `officialGroupBinding` / `platformGroupBinding` | 由可信渠道事实合成群绑定 | **留在内核**：插件不得自行生成绑定（不变量 2） |
| `routing/admit-batch.ts` | 复核插件提交的批次 | **留在内核**：04「social.admitBatch … 内核只读复核」 |
| `kernel/quota.ts`、`kernel/quota-wire.ts` | 外人额度，插件运行前的准入 | **留在内核**：单一安全层（05） |
| `runtime/model-quota.ts`、`runtime/quota-source.ts` | 模型账号额度窗口 | 与社交无关，留在 runtime |
| `kernel/peer.ts` | 建 Agent 时的 peer/outsider 绑定与配置档 | **留在内核**：配置生成期，无插件运行 |
| `control/social-methods.ts` | 控制面薄门面 | 留在内核，内部委托插件 |
| `delivery/social-guard.ts` | 拒绝向 denied/mute/quiet 会话回复 | **D1 迁移**：social 插件已注册 `beforeSend`（`plugins/social/src/index.ts`） |
| `routing/group-session.ts`、`views/social-group.ts` | 主会话群摘要显示（IMP-18） | 生产无注册调用；**交维护者决定**：接线或删除，不搬运死代码 |
| `delivery/outsider-guard.ts` | 外人输出/输入闸门（IMP-26） | 生产无调用者；**交维护者决定**：接线（作为 hooks 插件）或删除 |
| `routing/social.ts`（`socialDecision`、`socialBindingAllowed`） | 候选收窄与唤醒判定 | **D2**：需要参与判定接缝 |
| `config/social-schema.ts`、`config/social-validation.ts`、`kernel/social.ts` 写入半 | agent.yaml `social:` 段的 schema、默认值、跨文件校验、审计写入 | **D2**：需要 agent 配置段贡献接缝 |
| `kernel/card-visitor.ts` | 旧 home 迁移，补 `card-visitor` 绑定 | **D2**：需要加载后迁移接缝，或并入 channel-card 已有的升级命令 |

## D1（无需新接口）

- `delivery/social-guard.ts` 的判定改由 social 插件的 `beforeSend` 承担；core 投递路径删除该调用。行为必须一致：同样的拒绝原因写入同样的事件字段。
- 验收：`plugins/social`、`packages/core/src/delivery` 单测；真实 Luna 群聊 live 全部通过。

## D2 接缝草案（待批准）

11 写明 social「不新增插件槽」，所以三处接缝都作为现有槽的可选扩展，SDK 只增不删（20 §4）。

1. **参与判定** `Hook.participation?(input): HookResult<ParticipationDecision>`
   - 输入：事件、目标 Agent 的只读配置视图、发送者 person、渠道 features、内核已算出的绑定事实（是否由平台/官方群绑定接纳）。
   - 输出：与现有 `socialDecision` 返回值同形（`reason`、`run`、`revision`、可选 `policy`），外加 `bindingAllowed(binding)` 的等价判定。
   - 规则：只有该 Bot/群实际选中的参与策略插件被调用（沿用 04「群作用域与参与策略」的选择规则）；没有选中插件时内核按 08 只记录；插件结果只能收窄，不能把内核判定为不运行的事件改为运行。
   - 调用点：routing 三处、`delivery/outbound.ts`、批次复核。
2. **agent 配置段贡献** `PluginModule.agentConfig?: { section: string; schema; defaults; validate(home) }`
   - 内核负责锁、revision、dry-run/confirm、热重载和失败保留旧状态（不变量 9）；插件只提供 schema、默认值和跨文件校验。
3. **加载后迁移** `PluginModule.migrate?(home): Promise<MigrationReport>`
   - 只在 `yonder migrate` / doctor 显式调用，可预览、幂等、先备份；不在启动时静默改写配置。

## 风险

- `socialDecision` 每条入站消息都会调用，接缝必须同步可用、无额外模型调用。
- 现网三个 QQ 实例仍是旧配置；D2 不得改变旧 home 的行为，迁移仍走 `yonder-qq upgrade-groups`。
- 真实 QQ 平台收发不在子 Agent 能验收的范围内，D2 合入前需要维护者安排平台验收。
