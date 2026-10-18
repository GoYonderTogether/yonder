# 0.1 任务

任务文档是目录：每条任务只写"做什么、依据哪几行规范、改哪些路径、怎么验收"。设计以 `docs/spec/` 为准，任务文档不重复设计内容。

## 通用规则（每个任务都适用）

1. 开工前读 [architecture.md](../architecture.md) 全文和任务列出的规范行。
2. 规范没写的行为不要发明。遇到规范空白或矛盾：停下，在任务文件末尾的"问题"一节写明，不要自行决定。
3. 只改任务"路径"一节列出的目录。
4. 不写模拟模型、假数据、示例人设。需要模型的测试用真实模型 `chatgpt/gpt-6-luna`；没有凭据时跳过，并在测试输出中明确写"未测：缺少凭据"。
5. 不加规范外的功能、配置项、命令或字段。
6. 依赖锁定精确版本。新增依赖要在任务结果里说明理由。
7. 完成时在任务文件末尾追加"结果"一节：改了哪些文件、测试命令与输出摘要、偏离规范之处（应为无）。

## 仓库布局（T01 建立）

```
packages/
  sdk/      @yonder/sdk    插件 API 类型、define* 辅助函数、testing/checkPlugin
  core/     @yonder/core   内核；src/runtime/ 是唯一 import pi 运行时的目录
  cli/      @yonder/cli    yonder 命令
plugins/
  channel-cli/             @yonder/plugin-channel-cli
  context-files/           @yonder/plugin-context-files
```

`@yonder/sdk` 可以 `import type` pi-durable 的工具与执行环境类型并重新导出；除此之外，pi 的包只出现在 `packages/core/src/runtime/`。

工具链：Node ≥ 22.19（pi 的要求）、TypeScript、npm workspaces、vitest、`yaml`。

## 顺序

| 任务 | 内容 | 依赖 |
|---|---|---|
| [T00](T00-pi-spike.md) | 验证 pi 能力，把结论写回规范 | — |
| [T01](T01-scaffold.md) | 仓库骨架与工具链 | T00 |
| [T02](T02-sdk.md) | SDK 类型与契约测试 | T01 |
| [T03](T03-config.md) | 配置加载、校验、热重载 | T02 |
| [T04](T04-store.md) | 事件、会话元数据、身份的存储 | T01 |
| [T05](T05-runtime.md) | pi 适配层：模型、凭据、会话、钩子、上限 | T00 T03 T04 |
| [T06](T06-plugins.md) | 插件加载 | T02 T03 |
| [T07](T07-routing.md) | 绑定解析与会话管理 | T04 T05 |
| [T08](T08-prompt.md) | 提示词组装 | T05 T06 |
| [T09](T09-delivery.md) | 投递与内置工具 | T07 T08 |
| [T10](T10-first-plugins.md) | channel-cli 与 context-files 插件 | T06 |
| [T11](T11-cli.md) | CLI 与本地控制接口 | T07 T09 T10 |
| [T12](T12-acceptance.md) | 0.1 端到端验收 | 全部 |
