# 0.1 任务

任务文档是目录：每条任务只写"做什么、依据哪几行规范、改哪些路径、怎么验收"。设计以 `docs/spec/` 为准，任务文档不重复设计内容。

## 状态

| 任务 | 内容 | 依赖 | 状态 |
|---|---|---|---|
| [T00](T00-pi-spike.md) | 验证 pi 能力，把结论写回规范 | — | 完成 |
| [T01](T01-scaffold.md) | 仓库骨架与工具链 | T00 | 完成 |
| [T02](T02-sdk.md) | SDK 类型与契约测试 | T01 | 待做 |
| [T03](T03-config.md) | 配置加载、校验、热重载 | T02 | 待做 |
| [T04](T04-store.md) | 事件、会话元数据、身份的存储 | T01 | 待做 |
| [T05](T05-runtime.md) | pi 适配层：模型、凭据、会话、钩子、上限 | T00 T03 T04 | 待做 |
| [T06](T06-plugins.md) | 插件加载 | T02 T03 | 待做 |
| [T07](T07-routing.md) | 绑定解析与会话管理 | T04 T05 | 待做 |
| [T08](T08-prompt.md) | 提示词组装 | T05 T06 | 待做 |
| [T09](T09-delivery.md) | 投递与内置工具 | T07 T08 | 待做 |
| [T10](T10-first-plugins.md) | channel-cli 与 context-files 插件 | T06 | 待做 |
| [T11](T11-cli.md) | CLI 与本地控制接口（完成后 CLI 可用） | T07 T09 T10 | 待做 |
| [T13](T13-skills.md) | skill 发现、索引与 `skill_view` | T08 T09 | 待做 |
| [T14](T14-release.md) | 安装、更新、服务、版本通知 | T11 | 待做 |
| [T12](T12-acceptance.md) | 0.1 端到端验收 | 以上全部 | 待做 |

状态只有四种：待做、进行中、阻塞、完成。按表格顺序做。

## 实现循环

实现者（例如在另一个环境里循环运行的 GPT）每一轮：

1. `git pull`；读 [AGENTS.md](../../AGENTS.md)、[index.md](../index.md)、[architecture.md](../architecture.md) 全文。
2. 选表中第一个"待做"且依赖全部"完成"的任务；没有可做的就结束循环，报告每个"阻塞"任务卡在哪里。
3. 把它改为"进行中"，读任务文件和它列出的规范行。
4. 只在任务"路径"列出的位置写代码。
5. 验证：`npm run build && npm run typecheck && npm test && npm run lint` 全部通过，并逐条满足任务的"验收"。
6. 完成：在任务文件末尾写"结果"（改了什么、测试命令与输出摘要、偏离规范之处——应为无），状态改为"完成"，一个任务一个提交（提交信息以任务号开头，如 `T02: sdk types and contract tests`），推送到 `origin main`。
7. 卡住：规范有空白或矛盾、验收需要的条件不具备（例如缺凭据）、或同一处连续三次验证失败时——在任务文件的"问题"一节写明缺什么、在哪（`文件:行`）、可选方案与建议；状态改为"阻塞"；丢弃这个任务未完成的代码，只提交任务文件；回到第 2 步做下一个。

**不能做的事**
- 改 `docs/spec/`、`docs/architecture.md`、`docs/decisions.md`、`docs/index.md`、`AGENTS.md`。实现者只改任务文件的"结果""问题"两节与本表的状态列。设计变更由设计方完成：回答"问题"、改规范，再把状态改回"待做"。
- 规范没写的行为、配置项、命令、字段、依赖，一律不加。
- 写模拟模型、假数据、示例人设、占位功能。
- 修改已完成任务的代码，除非当前任务的验收需要且修改符合规范；这时在"结果"里写明。

**真实模型测试**：凭据文件路径取环境变量 `YONDER_TEST_AUTH`，默认 `<仓库>/.yonder/auth.json`（已被 git 忽略）；模型用 `openai/gpt-6-luna`。缺凭据时测试跳过并输出"未测：缺少凭据"；若这使任务的验收无法满足，任务记为"阻塞"，不能记为"完成"。

## 通用规则（每个任务都适用）

1. 开工前读 [architecture.md](../architecture.md) 全文和任务列出的规范行。
2. 只改任务"路径"一节列出的目录。
3. 依赖锁定精确版本。新增依赖要在任务结果里说明理由。

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

`@yonder/sdk` 只以 `import type` 重新导出 pi-ai 的 `Message`、`Models`、`Credential`，pi-durable 的 `ExecutionEnv` 与 typebox 的 `TSchema`（T02）；除此之外，pi 的包只出现在 `packages/core/src/runtime/`。插件只依赖 `@yonder/sdk`（04 §1）。

工具链（T01 已装）：Node ≥ 22.19、TypeScript 7（`tsc -b` 项目引用）、npm workspaces、vitest、Biome；`yaml` 由 T03 引入。
