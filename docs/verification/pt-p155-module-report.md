# PT-P155 模块报告验证

- 真实 `pi-lens` 4.4.6 MCP `tools/list` 握手确认 `pilens_module_report` 与参数。主人 pi-lens 原安装缺 `@earendil-works/pi-tui`，不能直接启动；临时测试目录复制安装并链接仓库已有依赖后可运行。发行环境需自行完整安装 pi-lens 及运行依赖。
- `YONDER_LENS_REAL=1 npx vitest run plugins/code-intel/test/module-report.test.ts`：2 通过；真实源码 `grep.ts` 的 `createGrepTool` 第 5 行，返回 callback 与 provenance。首轮 1 通过 1 失败，原因是测试期望 JSON 空格与后端紧凑序列化不符；修正后通过。冷图结果无跨文件图数据。
- 临时 HOME、只读导入 siliconflow 凭据槽：`agent-network run -- env HOME=<临时目录> PATH=<临时 pi-lens bin>:$PATH YONDER_MODULE_REPORT_REAL=1 npx vitest run plugins/code-intel/test/module-report-real.test.ts`：1 通过，真实 siliconflow/deepseek-ai/DeepSeek-V3.2 调用了该工具。
- `UPDATE_GOLDEN=1 npx vitest run plugins/code-intel/test/module-report.test.ts plugins/code-intel/test/code-intel.test.ts` 与正常重跑各 2 通过、1 跳过；插件工具注册由测试守护，无通用工具 golden。Biome 检查通过。全仓 file-size 检查失败：并行 SDK、delivery、runtime、tools、kernel 超基线；`npx tsc -b` 失败于并行 kernel/workspace 和 prompt/templates，均非本卡文件。
- 未测：不支持语言、focus 排序不扩扫描的对照、未选工具与 find/ls 注入、描述/schema token 增量、T05 截断缓存索引，以及远程执行环境。P158 后续读取 callback handle 的端到端验收尚未完成。
