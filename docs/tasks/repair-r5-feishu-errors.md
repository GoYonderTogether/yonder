# R5：真实飞书 HTTP 错误诊断修复

状态：待安装版 Yonder 接取。依据 spec/11 飞书实际缺权诊断与 R5 自维护闭环。

## 实际问题

R4 使用生产应用只读查询指定私聊的成员接口，实际返回 HTTP 400，插件只保留 HTTP 状态，丢弃飞书原生 code/permission_violations；无法区分接口不适用、缺权与应用未发布。随后会话历史接口 HTTP 200/code=0，证明不能将此前 400 解释为凭据失效或网络失败。

## 范围与验收

只改 plugins/channel-feishu/src/client.ts、plugins/channel-feishu/test/protocol.test.ts 和本任务结果。沿用既有有界响应读取及错误类型；HTTP 非成功且返回有效平台 JSON 时，保留 HTTP、原生数值 code 和平台明确提供的缺权 subject。无 JSON 的错误仍有 HTTP 诊断。保持副作用 uncertain 语义，凭据/请求对象不进入错误文本，不重发请求、不新增回退/抽象/依赖。不修改冻结规范。

先完整阅读该调用链、现有协议检查及 docs/tasks/next/reference-sources.md 指向的实际相关参考处理。只用相关上游模块，不扫描全部项目。最小检查须覆盖非 2xx 的真实形状平台错误、无 JSON HTTP 错误和既有副作用回执规则；无模型模拟，不发送真实外部消息。

Codex 准备独立工作树与任务分支；Yonder 自己修复、运行相关测试/typecheck、提交并推送该分支，调用 GitHub 插件创建目标为 zoran/first-pass 的 PR。禁止 push main、合并、发布或更新服务。PR 由 Codex 审核合并到本轮审查分支；整轮正式发布另依 R5 顺序执行。

## 结果

已实现并完成本任务最小检查，待 Codex 审查；未合并、发布、安装或更新服务。

- 来源：github-project / zoran-xc/yonder-harness#1；由安装版 maintainer（sol 配置档）接取，通过 channel-github_read_issue 读取完整 issue，并用 channel-github_comment 先报告最小方案。外部原生事件/session/model 关联由主路记录，不以测试或子 agent 冒称模型运行证据。
- 已读 AGENTS、文档地图、架构、任务循环、spec/11 飞书边界、reference-sources 以及 client → channel 发送/流式回执 → 工具错误输出链。只读核对 OpenClaw cafa09e50556e08c2a04a670f16ac815482c5489 的 send.ts 原生/嵌套响应 code 处理与 api-response.ts、send-result.ts，以及 Hermes 0eb4f62a8b35ff3b0454a8dbdbd3a7b55a6849b0 的 feishu_comment.py 响应解析、adapter.py 应用缺权诊断及 feishu_admission_diagnostics.py；未移植其重试/回退或原始正文日志。
- 修复共享 FeishuApi.json 提前取消非 2xx 正文的问题：统一沿用 2 MiB 有界读取，有效平台 JSON 保留 HTTP 状态、数值 code 和明确的 permission_violations.subject；非 JSON、错误形状、超限、不可读正文保留 HTTP。非 2xx 即使 code=0 也不会成为成功；4xx 拒绝和 5xx uncertain 沿用原规则，2xx 协议与不可读发送回执规则不变。只格式化白名单字段并经既有 safe 脱敏，不输出原始响应/请求对象。不新增请求、重试、回退、抽象或依赖。
- 协议回归检查覆盖 HTTP 400/403/503 平台缺权形状、随后 HTTP 200/code=0 成功、无 JSON/畸形正文、非 2xx/code=0、2 MiB 限制及取消、读取失败、凭据脱敏、请求次数；原有发送/流式 uncertain、确认消息 id、无替代发送等断言保留。仅隔离 HTTP 协议检查，没有模拟模型或真实外部消息发送。

实际验证（工作树 /tmp/yonder-r5-feishu-errors，分支 zoran/r5-feishu-errors）：

1. 原始协议测试基线：1 文件，6 通过、0 失败、0 跳过。
2. 先添加两个回归测试后在旧实现上运行：1 文件失败，6 通过、2 失败、0 跳过，分别复现原生错误诊断丢失及非 2xx/code=0 的 code 丢失。
3. 修复并扩展到 10 项后首次运行：9 通过、1 失败、0 跳过。失败为新增脱敏测试错误假设 registration collector 含 credentials 对象；显式提供测试 credential getter 后解决，未减弱断言。该次 && 后的 typecheck 未执行。
4. 最终 `./node_modules/.bin/vitest run plugins/channel-feishu/test/protocol.test.ts --exclude '**/dist/**'`：1 文件，10 通过、0 失败、0 跳过。
5. `npm run typecheck`（tsc -b --force）：通过。
6. `./node_modules/.bin/biome check plugins/channel-feishu/src/client.ts plugins/channel-feishu/test/protocol.test.ts`：2 文件通过；此前只对这两文件执行 check --write 格式整理。`git diff --check`：通过。
7. 使用 bash、精确路径 edit、GitHub 渠道工具和只读 `yonder --help` / `yonder docs --list`；本任务仅提交指定两个文件及本文结果，git 精确 add、commit，仅通过 agent-network 推送任务分支，并用 channel-github_create_pr 创建 base=zoran/first-pass 的 PR。commit/PR 由工具及 issue 最终报告关联。

未测：全仓测试、真实飞书服务端/客户端矩阵和真实模型验收（本任务不发送真实外部消息）；上述局部检查不替代 R4/N13/T12 的既有失败、跳过或验收记录。

## 问题

未发现需要新增规范的设计空白；未修改冻结规范。
