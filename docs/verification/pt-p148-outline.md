# PT-P148 验证（2026-10-28）

- `PATH=<pi npm bin>:$PATH npx vitest run plugins/code-intel/test/outline.test.ts --maxWorkers=1`：1 文件、1 测试通过；真实 ast-grep 0.51.0 解析仓库 TypeScript/Python，检查导入、读取位置、51 文件截断与原文缓存、缺 CLI 错误。
- 临时 HOME，经 `agent-network run` 执行 `YONDER_OUTLINE_REAL=1 vitest run plugins/code-intel/test/outline-real.test.ts --maxWorkers=1`：1 文件、1 测试通过；真实 siliconflow/deepseek-ai/DeepSeek-V3.2 调用工具。凭据只从主人 home 的 siliconflow 槽读取。
- `npx biome check` 本卡代码和测试通过；`npx tsc -b plugins/code-intel` 通过。全仓 `npx tsc -b` 失败：并行修改的 kernel/index.ts 缺少 projectRulesFor 导出、prompt/templates.ts 的 string | undefined 类型错误。`node scripts/check-file-size.mjs` 失败：并行修改的 sdk/types.ts 和 core delivery/index.ts、runtime/index.ts、tools/index.ts、kernel/index.ts 超限。
- 未单独验证未选插件上下文、描述/schema token 增量、核心 find/ls 规则与 T05 磁盘索引路径；截断测试验证缓存回调收到后端完整 JSON。尚未逐项核对 exports、嵌套成员及所有筛选参数。
