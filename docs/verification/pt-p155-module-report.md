# PT-P155 模块报告验证

- 真实 `pi-lens` 4.4.6 MCP `tools/list` 握手确认 `pilens_module_report` 与参数。主人 pi-lens 原安装缺 `@earendil-works/pi-tui`，不能直接启动；临时测试目录复制安装并链接仓库已有依赖后可运行。发行环境需自行完整安装 pi-lens 及运行依赖。
- `YONDER_LENS_REAL=1 npx vitest run plugins/code-intel/test/module-report.test.ts`：2 通过；真实源码 `grep.ts` 的 `createGrepTool` 第 5 行，返回 callback 与 provenance。首轮 1 通过 1 失败，原因是测试期望 JSON 空格与后端紧凑序列化不符；修正后通过。冷图结果无跨文件图数据。
- 临时 HOME、只读导入 siliconflow 凭据槽：`agent-network run -- env HOME=<临时目录> PATH=<临时 pi-lens bin>:$PATH YONDER_MODULE_REPORT_REAL=1 npx vitest run plugins/code-intel/test/module-report-real.test.ts`：1 通过，真实 siliconflow/deepseek-ai/DeepSeek-V3.2 调用了该工具。
- `UPDATE_GOLDEN=1 npx vitest run plugins/code-intel/test/module-report.test.ts plugins/code-intel/test/code-intel.test.ts` 与正常重跑各 2 通过、1 跳过；插件工具注册由测试守护，无通用工具 golden。Biome 检查通过。全仓 file-size 检查失败：并行 SDK、delivery、runtime、tools、kernel 超基线；`npx tsc -b` 失败于并行 kernel/workspace 和 prompt/templates，均非本卡文件。
- 未测：不支持语言、focus 不扩大扫描的直接证明、模型实际上下文中的未选工具、DeepSeek 精确 token 增量、真实本工具结果触发 T05 截断，以及远程执行环境。P158 后续读取 callback handle 的端到端验收尚未完成。

- 隔离安装验证：`agent-network run -- npm install --prefix <临时目录> --ignore-scripts pi-lens@4.4.6 @earendil-works/pi-coding-agent@1.3.0 @earendil-works/pi-tui@1.3.0 typebox@1.3.27` 成功，使用安装目录 bin 与临时 HOME 跑真实后端 2/2 通过；无需修改主人 pi 安装。
- 真实报告对照：focus 与未设 focus 的 api、internal、callbacks 相同，推荐理由包含 focus；不能据此证明后端未扫描。工具未选中时真实注册通过内核 catalog 判为 plugin-not-selected；find/ls 指南的既有测试也通过。描述与 schema JSON 为 454 字节，gpt-tokenizer 4.1.0 估算 103 token，非 DeepSeek 精确计数。
- 真实 TypeScript lib.dom.d.ts 报告 39893 字节，未跨 50 KiB T05 阈值，runtime cacheSdkResult 原样返回；T05 的通用运行包装与缓存索引测试通过，但尚未验证真实本工具长结果触发截断。尝试 runtime/index.ts（19396 字节）和 lib.dom.d.ts（39893 字节）触发截断，测试均各 1 通过 1 失败；另一次错误路径导致 ENOENT，同样 1 通过 1 失败。最终联合测试 5 文件 8 通过。
