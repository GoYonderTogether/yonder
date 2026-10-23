# 提示词分层与可配置正文验证

日期：2026-10-23。工作分支：`zoran/prompt-layers`。独立工作区：`/Users/zoran/.codex/worktrees/prompt-layers/yonder-harness`。原 checkout 的未提交渠道/卡片工作未修改；未发布、未安装、未覆盖日用 home 的人格文件。

## 范围

重构系统内置全文、Jarvis 主 Agent 和普通常驻 Agent 官方模板，保留参考稿的写作案例并适配本机、多仓库、多渠道、子任务和后台进程。新增 agent-presets 插件只用既有 contexts/presets/scaffold。插件排障与交互规则写入各自工具描述。Profile.prompt 支持段落选择、排序、替换与清空；默认全量，不改变权限与投递。

设计与完整来源映射见 [提示词分层](../prompts/README.md)，配置见 [短上下文配置](../prompts/configuration.md)。

## 必需检查

| 命令 | 原始结果 |
|---|---|
| `npm ci --ignore-scripts --offline` | 314 packages；0 vulnerabilities；未增加外部依赖 |
| `npm run build` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm test` | 54 文件通过 / 11 文件跳过；201 用例通过 / 0 失败 / 23 跳过，共 224；18.11s |
| `npm run lint` | exit 0；186 warnings、1 info，未顺手修全仓警告 |
| `git diff --check` | exit 0 |
| `npm pack --workspace @yonder/plugin-agent-presets --dry-run --json` | exit 0；12 个包内文件，包含 dist/index.js 和两类角色的四份正文 |

默认全仓运行未开启真实模型开关，23 个跳过项仍记为未测。下列定向模型运行单独记录，不改写这组原始计数。构建、类型、测试、lint、打包原始日志分别在 `/tmp/yonder-prompt-{build,typecheck,test,lint}.log` 和 `/tmp/yonder-prompt-package.json`，均为本次本机临时证据。

新增自动检查覆盖：真实插件加载、SDK checkPlugin、init/scaffold、通过 management 创建普通常驻 Agent、最终装配顺序和确定性、工作区已编辑/已清空文件保留、任务会话不装载常驻人格、段落选择/替换/关闭、defaults 继承、未知/重复 id 与类型校验、无效管理修改不覆盖原配置。没有模拟模型。

最后仅为 Jarvis Markdown 段落补空行并整理文档后，定向复跑 `official-prompts.test.ts`：1 文件、1 用例通过，0 失败、0 跳过；日志 `/tmp/yonder-prompt-final-focused.log`。

## 真实模型试跑

使用 `openai/gpt-6-luna`，通过 `agent-network run` 启动测试进程；项目凭据仅由运行程序读取，未复制至测试 home、未写入日志。使用临时 home 和本地 CLI socket，不连接真实微信或飞书收件人。

一次性试跑脚本 `/tmp/yonder-prompt-smoke.mjs`，结果 `/tmp/yonder-prompt-live.log`，完整证据 `/tmp/yonder-prompt-live-vHetQm/evidence.json`。

| 路径 | 输入与实际观察 |
|---|---|
| init 创建的 Jarvis | 问如何照看本机多个仓库、有无云端电脑、插件断连如何排查，明确暂不操作。经 CLI 收到完整答复：区分仓库与未提交文件、不声称自带云电脑、区分插件安装/连接/认证/权限并按插件说明修复。 |
| default-agent 创建的普通常驻 | 要求两句自然介绍、不列提纲、不操作电脑。实际回复：“嗨，我会先弄清楚你想完成什么，再用手头合适的工具把事情踏实做好。遇到重要选择我会先和你确认，也会把进展和结果说清楚。” |
| 精简独立任务 | `prompt.sections: []`，contexts/skills/tools 清空，仅短 instructions。问缩短提示词是否改变工具权限；status=done，答“不会，缩短提示词本身不会改变工具权限；权限由系统配置和授权决定。” |
| 真实父子任务 | 父会话只提供 task_run；要求调用 default 预设说明任务与常驻身份区别。转录确认 **一次实际 task_run**，子会话 status=done，父会话 status=done 并交回结果。没有把用户消息里出现的工具名当成调用证据。 |

这四条为运行观察，不宣称人格质量已普遍改善。普通 Agent 仍有较常规的确认措辞；可继续由真实使用评估。未接入短上下文的本地模型，此处证明配置与装配路径可以缩短，不证明任意本地模型的上下文容量或工具遵从性。

首次试跑脚本误用未公开的 `kernel.events.ask`，在调用模型前报 `TypeError: kernel.events.ask is not a function`。已改用现有 CLI socket 后四条通过；保留首次日志 `/tmp/yonder-prompt-live-first.log`。这是验收脚本接线错误，没有改产品 API 或放宽断言。

## 后台进程与消息收尾

运行现有真实模型回归：

```sh
agent-network run -- env YONDER_TEST_REAL=1 \
  YONDER_TEST_AUTH=/Users/zoran/Documents/yonder-harness/.yonder/auth.json \
  npx vitest run packages/core/src/kernel/message-lifecycle.test.ts
```

原始结果：1 文件通过；**1 用例通过 / 0 失败 / 0 跳过**；39.77s。日志 `/tmp/yonder-prompt-lifecycle.log`，证据 `/tmp/yonder-message-live-LX9ll7/evidence.json`。

一次实际用户输入启动 bash 后台 sleep 18，先收到 M43_START 和等待气泡；runtime.tool-result 自动恢复原任务，模型执行第二条检查命令，发送 M43_RESUMED 和唯一一次 M43_FINAL。未轮询进程、未要求用户再次输入。两次 run.end 均 done。

如实保留措辞观察：等待气泡为 `M43_WAITINGM43_WAITING`，原生 assistant 转录已是 `M43_WAITING\nM43_WAITING`；因此重复在渠道投递前就存在。这不是两个最终结果，也没有重启第二个长命令。现有用例验证的是启动、自动续跑与唯一最终结果，不能据此声称每次模型表述都无重复；未改变断言或重复运行直到措辞好看。

## 未测与交付边界

- 未在真实小上下文本地模型上测量 token 或完成率。
- 未验真人微信、飞书、桌面卡片、浏览器重连、MCP 登录或生成图片；本轮这些插件改变的是随工具装入的说明，不是其执行协议。
- 未覆盖所有模型和长期角色表现；后续可据实际对话修订 SOUL/AGENTS，已有个体文件不会被官方模板升级覆盖。
- 未发布、未切换正式服务、未修改现有 Agent。代码和规范留在独立工作分支供合入。
