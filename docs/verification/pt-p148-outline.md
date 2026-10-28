# PT-P148 验证（2026-10-28）

- `PATH=<pi npm bin>:$PATH npx vitest run plugins/code-intel/test/outline.test.ts --maxWorkers=1`：1 文件、1 测试通过；真实 ast-grep 0.51.0 解析仓库 TypeScript/Python，检查导入、导出、嵌套成员读取位置、exports/type/match 筛选、51 文件截断和真实 T05 磁盘原文及索引、缺 CLI 错误。
- 临时 HOME，经 `agent-network run` 执行 `YONDER_OUTLINE_REAL=1 vitest run plugins/code-intel/test/outline-real.test.ts --maxWorkers=1`：1 文件、1 测试通过；真实 siliconflow/deepseek-ai/DeepSeek-V3.2 调用工具。凭据只从主人 home 的 siliconflow 槽读取。
- `npx biome check` 本卡代码和测试通过；`npx tsc -b plugins/code-intel` 通过。全仓 `npx tsc -b` 失败：并行修改的 kernel/index.ts 缺少 projectRulesFor 导出、prompt/templates.ts 的 string | undefined 类型错误。`node scripts/check-file-size.mjs` 失败：并行修改的 sdk/types.ts 和 core delivery/index.ts、runtime/index.ts、tools/index.ts、kernel/index.ts 超限。
- `npx vitest run packages/core/src/runtime/catalog.test.ts packages/core/src/runtime/prompt-guidelines.test.ts packages/core/src/runtime/find.test.ts packages/core/src/runtime/ls.test.ts --maxWorkers=1`：3 文件通过、1 文件跳过；10 测试通过、2 跳过。现有目录测试验证插件未选时 catalog 为 plugin-not-selected，规则测试验证未选 find/ls 时不注入其 guidelines；find 真实执行用例因环境缺 fd 跳过。这些是通用目录与提示词单元测试，未直接抓取实际模型请求上下文。
- outline 描述 95 UTF-8 字节、JSON schema 751 字节，合计 846 字节（`node --input-type=module` 对构建产物计数）；未测 DeepSeek tokenizer 的 token 增量，字节数不能当 token 数。其余筛选参数未逐项验证。
