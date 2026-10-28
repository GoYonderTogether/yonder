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

## 后续增量检查（同日）


## 范围与证据

复用现有事件、会话与 durable 转录，只读显示 Bot 来源、路由、会话事件、投递与历史工具结果；不新增会话存储。Bot 级事件与会话转录分开展示。平台消息 ID 和事件、session、attempt 的可用字段按真实记录展示，不推测缺失关联。

定向回归：console、observation-events、routing、social、delivery、gateway isolation 与 events golden 共 8 个文件、57 个测试通过。这些是自动化测试，不是实际渠道验收。

全量 `npm test`：295 文件中 241 通过、9 失败、45 跳过；1418 测试中 1320 通过、19 失败、79 跳过。失败涉及 code-intel 两项、hermes-experience alias、CLI bundles/completion/index/init/migrate 及 native-automation export 超时；并行工作区快照，不以聚焦结果覆盖原始计数。

`npm run build` 失败：并行源码缺少 `projectRulesFor` 导出，code-intel 有两处类型错误。`npx tsc -b --force` 同样失败。`npm run lint` 检查 917 文件，12 errors、595 warnings、16 infos，失败；`node scripts/check-file-size.mjs` 因 routing/index.ts 522 行新增超限失败。前端 app build 通过。

临时 HOME 真实预览尝试：app 构建成功，临时 kernel/gateway 因缺少 `projectRulesFor` 导出无法启动；没有截图，没有触碰主人 home 或服务。必须在构建恢复后重新运行并补截图。

## 未完成的真实验收

- 两个真实渠道给主人同一 Bot 发消息、来源回复和打开 Console 不改变目标：未测；缺实际平台测试账号及权限。
- 授权群、陌生人、专属 Agent 的隔离及无权用户读取：真实平台未测；不以自动化权限测试代替。
- 多消息 steer、后台完成、显式 message_send + final、部分流失败、重启未知投递：缺实际事件链、run/session/attempt 和平台原生 ID，均未测。
- quiet/digest/off、群 20 条/60 秒、folded/judge 预算和动态调整：真实平台未测，不能由本卡视图声称完成。
- 未进入 transcript 且无法安全归属 session 的事件保持 Bot 级，不能凭推测塞进 main；下一次整理/汇总时刻依赖上游产生并公开事实，尚未验证。

完成增量后的复查：`npx tsc -b` 通过；改动涉及的 9 个代码、测试和 golden 文件 Biome 通过。来源视图、工具结果、session trace 定向检查 3 文件 3 测试通过；registry、session trace 和 events golden 关闭更新变量后 3 文件 5 测试通过。按测试支持的 `UPDATE_GOLDEN=1` 更新 methods golden，格式化后只增加 `sessions.trace`，旧方法保留；未新增 gateway 事件字段。最终 file-size 检查失败项已变为并行修改的 runtime/index.ts 1954 行，超过基线 2 行。以上保留前述初次检查的失败结果。

后续预览：源码测试方式在进程启动前设置临时 HOME，并补充 siliconflow provider 元数据后，临时真实 gateway 与独立 Chrome 已启动；截图步骤无响应，未产出可交付截图，未验证新增面板。首次尝试未隔离操作系统 HOME，曾只读显示本机 pi 会话列表；该截图已删除，未修改主人数据。没有发送消息或调用模型。
