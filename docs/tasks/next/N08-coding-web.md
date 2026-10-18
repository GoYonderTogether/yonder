# N08 grep、Bash、Tavily 与 Web Fetch

**状态**：C2 Web 插件已实现（未验收）；grep/Bash 与根组装由主 agent 继续。

**负责人**：本轮 Web 插件由 Codex C lane 实现；grep/Bash 由主 agent 实现。原 Yonder 自主开发目标与后轮安装验收保留。

**依赖**：N03。不依赖 BrowserSkill、Computer Use 或 hosted search。

**功能依据**：11 §5；原 05/07 的文件与工具约束。完整条款见 [10](../../spec/10-local-maintenance.md)、[11](../../spec/11-official-plugins.md)，本任务不定义新功能。

## 允许路径

- packages/core/src/runtime/ 的 grep、能力表和 Bash 必要适配
- plugins/web-tools/
- 根 workspace/锁文件接线、THIRD_PARTY_NOTICES.md
- 对应检查与原任务记录、安装 home 的批准凭据引用

本任务文件、任务总表和必要 CHANGELOG 记录可更新；冻结功能文档仅 N00 的设计方可按批准修改。

## 实现安排

复用 pi Bash，增加真正只读 grep，移植 Web 工具并接通 Tavily Search/Extract；按 10 §2.1 安装后由 Yonder 调用。hosted search 独立归 N06，当前任务不等待它。

## 验证与交付

实际文件检索与路径边界、Bash 取消/退出码/输出；真实 Tavily 搜索和 Extract、文章读取/登录提示。保留安装版调用证据，hosted search 的结果引用 N06，不作为本任务通过条件。

记录实际命令、event/session/model、commit/PR 与失败/跳过；Yonder 和 Codex 的贡献分开归属。

## 问题

独立工作树无 node_modules，不能在本 lane 完成正式项目 build。根 workspace/锁文件/项目引用/许可接线交主 agent；本轮没有真实 Tavily/HTTP/模型/安装验收。

## 结果

C2 新增 `plugins/web-tools/`，仅依赖 SDK 与包内精确声明的成熟正文库。Search 支持查询/数量/general-news/时间/域过滤/深度并保留供应商实际字段；Extract 独立显式调用；Fetch 支持最终 URL/MIME、成熟正文提取、Markdown/text/html、取消、超时、重定向、HTTP 错误、登录/JS 提示和二进制下载入口。有界读取与输出均明确，不自动回退/重试/接管浏览器。配置及固定参考 commit/模块/许可见包内 README/SOURCES。

实际检查：利用主仓 SDK/Node 类型与 AI-Being 已装提取库类型，在 `/private/tmp/yonder-web-typecheck.json` 做 strict/noEmit 独立 TypeScript 检查，通过；未安装依赖、未写/运行测试。该结果不替代根项目组装检查或实际 HTTP/Search 验收。实现者为 Codex，不记为 Yonder 自主完成。

grep/Bash、正式 workspace 组装及下一轮原验收仍待主 agent/用户后续放行；本任务不能整体标为验收完成。

