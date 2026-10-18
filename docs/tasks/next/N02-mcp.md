# N02 MCP 控制插件

**状态**：已实现；开发构建的真实 MCP/Luna 检查通过。安装版复验由 N03 完成。

**负责人**：Codex。

**依赖**：N01。

**功能依据**：11 §1–2；10 §3。完整条款见 [10](../../spec/10-local-maintenance.md)、[11](../../spec/11-official-plugins.md)，本任务不定义新功能。

## 允许路径

- plugins/channel-mcp/
- 根 package.json、package-lock.json、tsconfig.json 的 workspace 接线
- packages/sdk/src/、packages/core/src/plugins/ 中本任务证实必需的适配缺口，先记问题再处理
- 对应插件与 MCP 实际客户端检查
- packages/core/src/plugins/mcp.test.ts：在真实临时 home 中由标准 SDK 客户端检查，纳入现有 TypeScript 构建；插件生产代码不引用 core

本任务文件、任务总表和必要 CHANGELOG 记录可更新；冻结功能文档仅 N00 的设计方可按批准修改。

## 实现安排

实现 MCP 包与真实控制链，插件仅经 SDK 调业务 API；Codex 能从 MCP 提交、观察、取结果和中止。

## 验证与交付

标准 MCP 客户端实际列工具，真实 Luna 工具运行与事件/转录核对，明确 abort；边界检查不使用假模型。

记录实际命令、event/session/model、commit/PR 与失败/跳过；Yonder 和 Codex 的贡献分开归属。

## 问题

- 既有预设 submit 缺少真实调用方的内部注入，仍是 R5 的共享接口缺口；MCP 不接受伪造 from 参数来补它，按 N04/N09 的预设修复接续。常驻 agent 输入已使用固定的本实例账号并经绑定。
- SDK 1.32.1 的 Transport 可选 onclose 声明与项目 exactOptionalPropertyTypes 不兼容，generic ToolCallback 的条件类型也不能直接推断。只在这两个第三方类型边界使用断言；运行时仍用 SDK 原生传输与 Zod 入参检查，没有关闭项目类型检查。首次构建的类型错误已修正。
- 临时 home 已在检查结束后清除，没有保留其 event/session ID；检查实际断言了原生父事件、会话转录和终态，不编造 ID。N03 安装版开始保留持久运行证据。

## 结果

- **Codex 实现**：同仓库独立 `@yonder/plugin-channel-mcp`；官方 SDK 1.32.1 的无状态 Streamable HTTP，只监听 127.0.0.1，固定 `/mcp`。API key 只经现有 credentials 引用读取；校验 Bearer、Host、Origin，未就绪或监听失败报告具体原因，其他渠道继续运行。
- **18 个接口**：事件 emit/ask/query；会话 list/get/open/submit/abort/close/transcript；身份 account/person/relation/lookup/createPerson/link/unlink；messages.send。没有暴露凭据、服务密钥或登录接口，没有 MCP 自建任务表/队列。
- **输入边界**：message.in 的 from 由实例 account 固定，conversation 只能在本实例形成引用，不能传 from/conv/target 绕过绑定；自定义事件仅限本插件命名空间，kernel 事实由内核拒绝。
- **检查**：标准 SDK 客户端连接真实内核，发现 18 工具；来源身份、非法 kernel 事件、鉴权、Host 和 Origin 检查通过。首次不启用模型时 1 通过、1 跳过；启用真实 Luna 后完整执行，1 文件、2 测试通过（28.54 秒）。真实 bash 输出返回，原生转录有工具；取消等待后运行继续完成；显式 abort 后原生 run.end 为 aborted。
- **凭据处理**：在现有测试凭据文件中临时新增随机 MCP API key 引用，结束后删除；原 OAuth 不复制到临时 home，不进入聊天或转录。临时 home 的纯协议检查使用自己的临时凭据。
- **依赖与接线**：官方 SDK 及其原生 Zod 工具入参；沿用项目 TypeBox 配置校验。插件只依赖 SDK 和这些正常第三方包。workspace、锁文件、tsconfig 已接入；build 与改动文件 Biome 检查通过。
- **归属**：本项仍由 Codex 完成；没有安装、发布或 Yonder 自主开发的声明。继续 N03 的独立安装、登录、服务及阶段更新。

