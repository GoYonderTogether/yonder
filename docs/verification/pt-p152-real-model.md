# PT-P152 真实模型验收

在临时 HOME 使用 `siliconflow/deepseek-ai/DeepSeek-V3.2`，仅读取主人 home 的 siliconflow 凭据槽，测试结束删除临时凭据。临时复制 pi-lens 4.4.6，并链接仓库已有 pi-tui 和 pi-coding-agent，未修改主人 pi 安装。

`agent-network run -- env HOME=<临时目录> PATH=/tmp/yonder-p152-local/node_modules/.bin:$PATH YONDER_DIAGNOSTIC_MARK_REAL=1 npx vitest run plugins/code-intel/test/diagnostic-mark-real.test.ts --maxWorkers=1`：最终 1 文件、1 通过、0 失败、0 跳过，23.80 秒。真实 pi-lens 分析 C 源文件，返回 `use of undeclared identifier 'missing_name'`，真实模型调用 `code-intel_lens_diagnostic_mark` 并持久写入 `flagged`。产物：`/tmp/yonder-p152-real.13kXf4/workspace/.pi-lens/dispositions.log`（临时目录可能清理）。

原始失败：使用主人原 pi-lens 时 MCP 因缺失 pi-tui 启动失败（1 失败）；临时副本启动后，P153 并行更改 diagnostics 接口导致测试以旧参数调用 session cache 失败（1 失败）。随后改为直接调用真实 `pilens_analyze` 获取诊断。另一次 TypeScript 分析无进展，由执行者主动取消；隔离 npm 依赖安装无进展，也主动取消。两次取消均不计通过。
