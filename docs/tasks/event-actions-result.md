# E1 事件程序更新与通知结果

状态：E1 程序更新与通知已实现并通过聚焦检查，待主路整合与实际验收。

## 已实现

- `channel-github.release` 精确事件订阅；只处理真实配置实例的 conv、repository 与 apply/updater 授权。
- 重新读取指定 Release，核对 ID、tag、正式发布状态及批准作者，再直接调用已有 `scheduleUpdate`，无 ToolContext、模型或新增更新器。
- notify 策略、陌生来源/实例/仓库不执行更新。原调度回执及 unknown 不重发语义沿用。
- README 更新程序路径与模型绑定的选择边界；无实际配置切换。

- 精确订阅共同核心 `release.update-result`，要求显式 `notifyUpdates` 与 `notifyTarget`，只处理 repository/install/home 匹配的更新。根据 verified/status 生成简短事实文案并直接调用 messages.send；每 updateId/实例先持久化 attempt 后发送并保留 delivery，未知不重发，不扫旧历史。
- 旧 `channel-github.update-result` 恢复路径不变，不订阅其程序通知，避免同次 CLI/runner 双通知。

## 检查

- `npx vitest run plugins/channel-github/test/actions.test.ts plugins/channel-github/test/repair.test.ts`：2 文件、30 项通过；0 失败/跳过。函数注入/原有协议检查，不是实际 GitHub/launchd 更新或模型验收。
- `npx tsc -b plugins/channel-github`：共同 SDK/配置/上下文接线后通过。
- 局部 Biome：通过，有 repair.test.ts 原有 4 条非空断言警告；未削弱断言。

## 问题与未完成

- 共同完成事件已按主路冻结契约实现；index 已注册 availability context，channel.releases 只读公开，使用真实 api.version。
- 未实际发送消息、执行更新、安装发布或修改正式 home；上述测试是注入发送函数/回执的协议验证。

## 整合修正

- 程序 apply 在重新读取并校验真实 Release 后复用 `compareVersions(current.version, api.version)`，仅严格新于当前 host 的版本调度，防止同版重复或旧版晚发布触发自动回退；显式 update_schedule 工具不变，保留用户回滚授权。
- 修正后类型构建通过；同/旧版新增聚焦检查后原命令为 2 文件 32 项通过、0 失败/跳过。局部 Biome 通过。
