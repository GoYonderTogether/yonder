# RightAPI、模型回退与跨渠道命令

2026-10-23，基于正式源码 d5c08d6（0.2.26102206），隔离分支 `zoran/rightapi-fallback`。开发验收版本 `0.2.26102301-rightapi.1`；维护者随后要求合并 main 并发布正式 `0.2.26102301`。主工作区原有名片任务改动未纳入。

## 实现

- `Profile.fallback: { models: string[], after?: number }`，默认 3。会话 `/model` 覆盖持久化到原生 SessionDoc，运行中设置只影响下一次运行。
- pi fork 发布提交 `3c6d1d161320e6eb1b0d777b704e5b12b0e32ffa`：原生 run 保存当前模型索引、连续失败计数；分类错误与重试 checkpoint 同事务。成功响应清零，新运行从主模型开始。每个模型最多连续失败 after 次；取消、上下文超限保留原生行为。请求内 SDK 重试为 0，避免三个外层失败实际打出更多请求。未配置回退沿用既有重试策略。
- 共用 `/model`、`/model list [provider]`、`/model <primary> [fallback ...]`、`/model effort <level>`、`/model after <n>`、`/model reset`、`/status`、`/compact [说明]`。通过原来源命令投递，沿用去重与权限。只读命令不调用模型，压缩使用原生后台任务。
- 状态显示当前供应商/模型、主模型/回退链/失败计数、effort、上下文估计/窗口/输出上限、可否压缩及原因、压缩 Task ID、当前会话与原生后代任务 ID/父 task/session/Agent/model/effort、授权的内部委派目标会话，以及主会话消息绑定的渠道。
- RightAPI 作为配置供应商：`anthropic-messages`、`forceAdaptiveThinking: true`、Sonnet/Opus 两模型、上下文 272000。密钥不在源码。272K 是用户指定的本地窗口，未做满窗口负载验证。

## 验证与原始结果

- `npm run build`、`npm run typecheck`、`npm run lint` 最终退出 0。lint 322 文件，322 warnings、13 infos，无 error；保留现有警告，没有顺手清理。
- 最终默认全套：94 文件通过 / 18 文件跳过；384 用例通过 / 0 失败 / 36 跳过，共 420。跳过的真实模型/平台检查不算通过。
- 显式真实模型定向：`runtime/fallback.test.ts` 2 通过 / 0 失败 / 0 跳过。真实 HTTP 401 注入，第三次切换到真实 `gpt-6.1-sol`，真实 bash 副作用只一次；中途重启保留计数并续办；下一轮重回主模型；三模型 3+3+3 次失败耗尽；退避中取消后没有更多请求。真实 Luna 手动压缩返回 Task ID，并生成 `pi.compaction`；额外验证手动压缩、阻塞压缩各在主模型 3 次 HTTP 401 后使用真实 GPT 摘要，阻塞压缩后继续 GPT 生成。最终定向检查 2/0/0（45.22 秒）。
- 会话命令隔离/持久化/非法模型/非法次数/非法 effort/不可压缩原因，以及标准 MCP 客户端 `sessions_command status` 均在默认全套中验证。
- RightAPI Sonnet、Opus 最小真实请求均 stop 成功；额外的完整 Yonder Runtime + Sonnet + 真实 read(package.json) 工具循环成功，最终模型确为 RightAPI；上下文窗口 272000、请求后估计 1214 tokens、effort medium。
- pi 修改源码通过 4 文件、138 个既有恢复/压缩/会话/事件测试。临时 Vitest 配置绑定本次 durable 源码与已安装依赖，避免工作树缺少 workspace dist。上游 `npm run check` 曾因缺模型数据/依赖布局报大量错误；恢复依赖后仍被旧测试引用与当前生成模型目录的类型不一致阻断，未修改无关 AI 模型测试。harness 中 vendored durable 的完整构建与类型检查通过。
- 如实保留早期失败：RightAPI 未启用 adaptive/medium 时两轮各 2 个 HTTP 400，按真实错误修正配置后成功；默认首次 383 通过 / 1 失败 / 35 跳过（MCP 工具数断言 19→20），修正后 384/0/36；回退测试前两次各 1 失败（轮询默认窗口太短；重启关闭导致旧 waiter 的预期拒绝未捕获），第三次通过，最终含压缩 2/0/0。早期 pi 临时测试依赖路径曾导致 4 suite 加载失败、0 用例执行；显式依赖配置后 138/0。扩展压缩用例首次运行 1 通过 / 1 失败（真实上游返回模型序列断言，原因未确定）；增加仅含 HTTP 状态的诊断后保持原断言重跑，2/0/0。

## 验收边界

本次没有向飞书或微信发送斜杠命令验收消息；实际真人客户端的命令显示、长结果排版与按钮交互不属于上述测试证据。`/compact` 回执表示原生任务已接纳；`/status` 显示其进行中 ID，压缩结束后任务消失，摘要保留在原生转录。generation、手动压缩和阻塞压缩均按同一阈值回退；阻塞压缩后的生成继续使用回退模型。

本地安装与配置检查结果由当前任务交付记录补充；发布与安装结果以 GitHub Release、CI 及运行服务的 version/commit/home/pid/ready 为准。

## 正式版准备

- 合并远端最新 main（8c02c22）后，统一所有 Yonder workspace 的版本和内部精确依赖为 0.2.26102301；pi-durable 保持 1.3.0。干净 npm ci、workspace 边界检查、typecheck、build、lint 退出0；默认全套96文件通过/17文件跳过，410通过/0失败/36跳过，共446；权限helper自检36通过/0失败。主分支新增decision-routing等既有变动已包含在这一轮检查中。
- 本机旧main相对origin/main分叉（7个旧提交）已原样保存在 `archive/main-before-rightapi-20261023`；当前main从远端最新main接纳本次功能，没有覆盖原card工作区的未提交改动。
- 原生fork提交已推送至 GoYonderTogether/pi 的 yonder/1.3，正式源码可按FORK_SOURCE.json重放。
- 版本统一时首次npm lock安装失败（内部依赖仍钉旧版本，registry 404，随后一次网络ECONNRESET）；统一内部依赖后，离线lock刷新及干净npm ci通过。

- 压缩回退补齐后的最终检查：build、typecheck、workspace 边界、lint 均通过；默认 410 通过 / 0 失败 / 36 跳过；权限自检 36/0。lint 检查 327 文件，323 warnings、13 infos，无 error。曾误调用不存在的 npm check:workspace，改用仓库既有 node scripts/check-pi-durable-workspace.mjs 后通过。
