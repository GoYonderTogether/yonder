# U01 可续聊任务与真实控制面

**依据**：docs/spec/12-terminal-interaction.md 及其关联 02/03/06–09；D30。

**依赖**：U00。

**允许路径**：packages/sdk/src/、packages/core/src/runtime/、packages/core/src/sessions/、packages/core/src/kernel/、packages/core/src/control/、packages/core/src/index.ts、plugins/channel-cli/、packages/cli/src/index.ts（控制入口）、docs/tasks/terminal/、CHANGELOG.md。

**必须**：落实 spec/12 §7：manual 生命周期、busy、接纳事件、真实状态/转录/工具观察与目标信息；保持默认 task_run 与路由投递。

**验证**：构建/类型；生命周期和控制流的定向检查；真实 Luna 连续两轮、明确 abort/关闭/恢复，缺凭据如实未测。

## 问题

暂无。

## 结果

完成：manual 关闭策略持久化在原生扩展文档，SessionsAPI 暴露实际策略；显式 task 支持原生 busy；控制接口新增真实预设/渠道/会话信息、接纳事件与专用只读观察连接。观察复用原生消息/工具/运行事件，断开仅清理观察者；channel-cli 返回真实接纳事件/路由。

验证：npm run build 通过；真实模型与控制/离线检查 3 files passed、5 tests passed（首次原始结果，22.45s）。Luna 实际执行 bash/pwd、连续追问并跨 kernel 重启保留上下文，manual 显式关闭后拒绝提交。不是日用安装验收。定向 Biome 无错误，保留 4 项既有/契约类型警告。
