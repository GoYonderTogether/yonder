# R5：真实飞书 HTTP 错误诊断修复

状态：待安装版 Yonder 接取。依据 spec/11 飞书实际缺权诊断与 R5 自维护闭环。

## 实际问题

R4 使用生产应用只读查询指定私聊的成员接口，实际返回 HTTP 400，插件只保留 HTTP 状态，丢弃飞书原生 code/permission_violations；无法区分接口不适用、缺权与应用未发布。随后会话历史接口 HTTP 200/code=0，证明不能将此前 400 解释为凭据失效或网络失败。

## 范围与验收

只改 plugins/channel-feishu/src/client.ts、plugins/channel-feishu/test/protocol.test.ts 和本任务结果。沿用既有有界响应读取及错误类型；HTTP 非成功且返回有效平台 JSON 时，保留 HTTP、原生数值 code 和平台明确提供的缺权 subject。无 JSON 的错误仍有 HTTP 诊断。保持副作用 uncertain 语义，凭据/请求对象不进入错误文本，不重发请求、不新增回退/抽象/依赖。不修改冻结规范。

先完整阅读该调用链、现有协议检查及 docs/tasks/next/reference-sources.md 指向的实际相关参考处理。只用相关上游模块，不扫描全部项目。最小检查须覆盖非 2xx 的真实形状平台错误、无 JSON HTTP 错误和既有副作用回执规则；无模型模拟，不发送真实外部消息。

Codex 准备独立工作树与任务分支；Yonder 自己修复、运行相关测试/typecheck、提交并推送该分支，调用 GitHub 插件创建目标为 zoran/first-pass 的 PR。禁止 push main、合并、发布或更新服务。PR 由 Codex 审核合并到本轮审查分支；整轮正式发布另依 R5 顺序执行。

## 结果

待运行。外部 issue/原生事件/session/model/工具/commit/PR 关联由主路记录，不以 Codex 子 agent 核对冒称 Yonder 自主成果。
