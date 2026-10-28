# CH-07 验收记录（2026-10-28）

## 本次范围与证据

- 会话内「来源与路由」按需读取最近 50 条 durable transcript 对应的来源事件，展示原文、来源、平台消息 ID（若有）和当前会话路由。persistent 会话标题包含会话 key。历史分页接口先按 ID 降序取最近页，再转为升序；来源顺序沿用该页。
- `packages/gateway/test/scope.test.ts` 新增真实内核/网关检查：owner 的 transcript 关联入站事件，精确查询返回消息正文和会话路由；非 owner 对 Bot transcript 和该事件的读取为 403。此测试使用临时目录、write binding，不调用模型或外部渠道。
- 临时 HOME、真实内核和网关、构建后的 app、独立无头 Chrome：使用 console write 输入，展开来源区后断言原文与 binding 可见；[截图](ch07-console-preview.png)。页面会话流当时显示「连接中」，因此只证明来源面板显示，不证明完整会话流。无模型调用、外发或主人服务操作。临时目录已清理。

## 原始检查结果

- `npx vitest run apps/app/test/identity.test.ts apps/app/test/useSession.test.ts packages/core/src/delivery/console.test.ts packages/core/src/delivery/delivery.test.ts packages/core/src/routing/index.test.ts`：4 文件通过，41 测试通过，0 失败，0 跳过。
- `npx vitest run packages/gateway/test/scope.test.ts packages/gateway/test/isolation.test.ts packages/core/src/runtime/transcript-range.test.ts`：2 文件通过、1 文件跳过；6 测试通过、0 失败、1 跳过（未启用真实模型）。增加检查后单跑 `scope.test.ts`：1 文件、3 测试通过。
- 临时浏览器检查首次 1 文件 1 测试失败：隔离 HOME 未配置 siliconflow 模型目录，内核拒绝未知模型；只读导入本机 siliconflow provider 配置后再运行：1 文件 1 测试通过。没有导入凭据或调用模型。
- `npx biome check` 本次 5 个代码/测试文件：首次 1 处格式错误，修正后通过；`npm run build:app` 通过。
- `npx tsc -b` 和 `npm run build` 失败：并行改动的 `packages/core/src/kernel/index.ts` 引用不存在的 `projectRulesFor`，`packages/core/src/prompt/templates.ts:48` 参数类型错误。
- `node scripts/check-file-size.mjs` 失败：并行改动的 `packages/sdk/src/types.ts` 503 行、新超限，`packages/core/src/tools/index.ts` 538 行、比基线多 14 行。
- 临时 HOME 直接使用 CLI dist 启动失败：同一缺失 `projectRulesFor` 导出；随后通过源码测试运行真实网关完成上述面板预览。

## 未完成与未测

1. 两真实渠道同一 Bot 的接收、模型工具过程和按来源回复：真实渠道未测，未接入平台测试账号；没有运行真实模型。
2. 授权群、陌生人、专属 Agent 的真实渠道隔离和拒绝访问：未测；仅上述网关 owner/非 owner 边界已测。
3. 多消息 steer、后台完成、显式 message_send + final、部分流失败、重启未知投递：未做真实事件链和平台原生 ID 验收，不能用单元测试代替。
4. quiet/digest/off、群 20 条/60 秒、folded/judge 预算及动态调整：未做真实联调。
5. 目前面板只覆盖最近 50 条转录已有事件；未进入转录的 ignored/batched/muted 原因、下一次整理时刻、投递事件与来源回复关联尚未展示；截图中的完整会话流未验证。CH-02–06 依赖完成后仍需逐项联调。
