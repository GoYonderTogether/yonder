# PT-P158 验证记录（2026-10-28）

- pi-lens 4.4.6 真实 MCP tools/list：file、symbol 必填，kind 可选。本机安装缺 pi-tui，启动失败；临时复制后链接仓库 pi-tui 和本机 web-tree-sitter 后成功握手。工具通过 ToolContext.env.exec、cwd 和 signal 调用后端。
- PATH=<临时后端>/bin:$PATH YONDER_LENS_REAL=1 npx vitest run plugins/code-intel/test/read-symbol.test.ts：初次 1 通过、1 失败（上游重名提示不符合断言）；适配后 2 通过、0 失败、0 跳过。真实源码验证函数、类成员、回调句柄、重名、改名、删除和长符号；描述与 schema 序列化 352 bytes，未选插件的 catalog 为 plugin-not-selected。
- agent-network run -- env HOME=<临时 HOME> PATH=<临时后端>/bin:$PATH YONDER_READ_SYMBOL_REAL=1 npx vitest run plugins/code-intel/test/read-symbol-real.test.ts --silent=false：真实 siliconflow/deepseek-ai/DeepSeek-V3.2 1 通过、0 失败、0 跳过；模型实际调用工具 start/end，运行状态 done。凭据从指定槽只读导入，临时凭据已删除。首次错误地先设置 HOME 导致 agent-network 找不到配置，未发起请求。
- npx biome check 本卡代码和测试通过。node scripts/check-file-size.mjs 因其他并行改动失败：sdk/types 503 行，delivery、tools、kernel 超基线；npx tsc -b 因其他并行改动的 workspace 缺 projectRulesFor、prompt/templates 可空字符串报错。
- `UPDATE_GOLDEN=1 npx vitest run plugins/code-intel/test/read-symbol.test.ts` 及去掉变量重跑各 1 通过、1 跳过（未启用真实后端）；没有 golden 变更。
- pi-lens 自身在 40 KiB 截断，T05 只能缓存后端已返回的内容，不能检索被上游裁掉的完整原文；完整长结果、T05 索引、token 数和核心 find/ls 未选工具规则仍待验证或实现。工具没有独立 golden，注册形状由本卡测试检查；未更改冻结项 golden。
