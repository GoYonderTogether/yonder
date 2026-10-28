# P156r3 项目报告验证（2026-10-28）

`code-intel_project_report` 复用选定执行环境内的共享 pi-lens MCP，冷缓存返回构建状态，热缓存返回报告。工具、契约和注册分别见提交 b7c3fa1、ed5462a、177667b；测试格式修正见 85f9fd2。

包级 TypeScript 与 Biome 通过；相关测试原始结果：常规运行 1 通过、1 跳过。首次干净副本真实后端运行 1 通过、1 失败（本机 pi-lens MCP 无执行权限）；临时复制后重试 1 通过、1 失败（测试错误地要求 JSON 冒号后无空格）。使用同一副本的真实后端直接调用：冷返回 available:false 且后台构建，同连接后续返回 available:true。真实模型 siliconflow/deepseek-ai/DeepSeek-V3.2 的工具调用测试 1 通过、0 失败、0 跳过。

干净副本全仓构建失败：并行的 ast-grep-replace 使用 SDK 未提供的 authorizeFileWrite；与本卡无关。更新后的测试尚未在干净副本重跑：共享验收 HOME 被其他任务使用，verify-copy.sh 拒绝更新。verify-home.sh 曾启动并已停止本卡 HOME；由于副本构建失败，未用 real-check.sh 声称完整 gateway 验收。
