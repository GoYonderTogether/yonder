# PT-P153 验收记录

当前实现通过 `pi-lens-mcp` 拉取 LSP 诊断，支持 source、scope、paths、severity 和 mode；原有单个 path 调用保持 LSP 行为。MCP 每次调用启动新进程，未接入 Yonder 会话诊断缓存，因此 session 请求明确返回不可用，不能将空缓存视为无错误。

- `npx vitest run plugins/code-intel/test/diagnostics.test.ts`：1 个文件、1 个测试通过，覆盖 session 明示和默认请求。
- `npx biome check --write plugins/code-intel/test/diagnostics.test.ts plugins/code-intel/src/diagnostic-mark.ts`：完成；共享文件中的 P152 代码有非空断言警告。
- 未测：真实 clangd 错误及修复后刷新、范围与严重级别、超大文件、不支持语言、取消和空结果；真实模型调用；token 增量、输出截断及 T05 缓存索引。
- 未完成：持久会话诊断缓存；批量 paths 下的 session defer 过滤。不得将此实现视为本卡完整验收。
