# R2 C 路结果：Web / Codex / Skills

日期：2026-10-18。起点 R0 `ae60bf2`。本路由 Codex 子 agent 完成，不能记作安装版 Yonder 自主开发或真实服务验收。共享 checkout，无切分支、暂存或提交；由主 agent 汇总提交。未改规范、原断言或跳过项。

## 实际修改

- `plugins/web-tools/src/index.ts`：Search/Extract/Fetch 的注册入口复用已装 TypeBox `Check(parameters,args)`，直接 execute 与模型参数共用 schema，拒绝未知字段；删重复标量/枚举/数组校验和 option helper。字符串 schema 保留非空白约束，URL 协议与用户凭据、供应商响应形状、HTTP 错误、取消与有界正文仍各在实际边界检查。预取消在读取凭据或 HTTP 前终止。
- `plugins/web-tools/package.json`：声明仓库已用的 `typebox: 1.3.27`；主 agent 已确认，根锁文件归主路同步。没有引入新第三方库。
- `packages/core/src/skills/manage.ts`：新增检查实际复现正常导入失败：独占 mkdir 后把整个来源 cp 到已存在目录且设置 errorOnExist，会直接 EEXIST。修为独占目录后逐项复制真实资源，保留同名拒绝、失败只清本次目录、资源符号链接拒绝和来源不删除。
- `plugins/web-tools/src/web-tools.test.ts`、`plugins/codex-tools/src/codex-tools.test.ts`、`packages/core/src/skills/skills.test.ts`：补边界检查，无模型、外部 HTTP 或真实 app-server 调用。

## 检查覆盖

Web：直接 execute 的必填/空白/类型/枚举/范围/未知字段、URL 协议及 URL 凭据拒绝；Tavily 缺凭据、默认参数与供应商字段、无结果与坏响应/Extract 失败、错误秘密脱敏；HTTP 重定向及上限、正文/输出截断、二进制下载入口、403/登录页/JS 提示、预取消无请求。HTTP 使用内存 Response/传输桩，只验证协议边界，不冒称真实供应商返回或提取质量。

Codex：原生 webSearch/HTTP(S) 来源缺失与非搜索执行拒绝；真实 request 实现的预取消、在途取消、deadline、写失败及 pending 清理；真实 close 实现的幂等、SIGTERM、仅清理拥有的临时目录。测试以无进程内存 wire/句柄驱动真实方法，不启动或模拟模型，不把测试片段记作 native 搜索证据。已有清单/静态能力/图片字段/原生配置检查保留。

Skills：正常导入和附属文件、同名拒绝、删除后来源保留；导入资源/管理根/删除目标符号链接拒绝、路径名穿越拒绝；workspace > home > plugin 遮蔽、实际 plugin id 来源、profile 选择、disable-model-invocation 与可显式读取分开；view 的资源符号链接越界拒绝。

## 实际命令与原始结果

```sh
npx vitest run plugins/web-tools/src/web-tools.test.ts packages/core/src/skills/skills.test.ts plugins/codex-tools/src/codex-tools.test.ts
```

- 首次：3 文件，2 通过 / 1 失败；14 测试，13 通过 / 1 失败，失败为 Skills 正常导入 EEXIST。没有删改失败断言；修复后同 14 测试全部通过。
- 补 Codex 取消/证据检查后：16/16 通过；补清理检查后：17/17 通过。
- 最终（14:30:58 本机时间）：3/3 文件、17/17 测试通过，0 失败、0 跳过；Vitest 未单列 cancelled 计数。

```sh
npx tsc -b plugins/web-tools plugins/codex-tools
npx tsc -b packages/core plugins/web-tools plugins/codex-tools
```

首次插件构建发现新测试的 PluginAPI 类型断言缺字段 1 项；补显式 unknown 转换后通过。首次 core 构建发现新预设测试缺必需 agent/profile 字段 6 项，首次补值 undefined 不符合实际 RuntimeSessionConfig，仍 6 项；改为实际契约 agent:null/profile:"default" 后最终三包构建通过（exit 0）。未改产品接口规避类型检查。

```sh
npx biome check plugins/web-tools/src/index.ts plugins/web-tools/src/web-tools.test.ts plugins/codex-tools/src/codex-tools.test.ts packages/core/src/skills/manage.ts packages/core/src/skills/skills.test.ts --write
git diff --check -- plugins/web-tools plugins/codex-tools packages/core/src/skills
```

Biome 初次格式化后有 2 个新测试非空断言警告，改成存在性检查/可选访问；后次 5 文件检查 0 警告。为缩小 diff，随后恢复 Web 原文件未触及代码的既有格式，仅保留功能差异；未宣称整个旧文件最终格式检查通过。最终 diff --check 通过。

## 未测与交接

- 未运行真实 Codex app-server、桌面/浏览器、hosted search、Tavily、模型、登录/系统授权、安装、发布或外部请求。这些仍按 R4 独立验收，不能将 17 项本地检查代记为真实能力通过。
- Codex 真实 native 搜索 item/source schema、账号权限和多会话资源隔离，Web 真实中文/新闻/域约束和正文提取质量，留 R4。
- 本路没有确认的新共享接口缺口；根 lock 同步由主路完成。Skills 的新确定错误已修并有回归检查。最终没有已知本路范围内阻塞。
