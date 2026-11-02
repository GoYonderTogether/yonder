# 共享 Bot 核心：包边界与本机行为验证

2026-11-03，两个指定 worktree 的共享核心任务阶段7。完整固定基线和阶段1–6记录见 [总记录](shared-bot-core-20261102.md)。本记录不证明worker、多租户运行、真实模型或设备工具已完成。

## 真实组合与边界

- `@yonder/bot-core.createBot` 统一注册插件、创建会话/路由/投递/出站工具并打开唯一 Runtime。本机 `@yonder/local-host.openKernel` 实际调用该入口，提供目录/SQLite、环境、管理与控制；云端组合待阶段8。
- `@yonder/runtime-adapter` 默认入口包含实际运行循环及注入契约，`/node`、`/postgres` 明确承载宿主实现。新包不建立旧文件名的隐藏宿主别名；移除91个新增纯转发文件，旧core路径直接兼容导出canonical实现。旧core生产源码合计285行，不留第二套业务算法。
- Store 为共享业务契约；SQLite/PG 使用各自原生SQL实现预算事实和通知偏好，核心不读裸Db。SDK collector/registrations为纯入口，不从testing传递载入FS。
- 扩展同一个 check-layers：检查共享包及workspace传递依赖、barrel/动态导入/exports映射、fs/child_process/os/process模块与宿主process属性读，以及全仓pi运行包只能在唯一adapter导入。保留原SDK两项纯Chord取消上下文辅助和CLI原生UI的精确例外，不能借此开启第二运行系统。现有TS scanner保留模板插值、不把注释/字符串当运行代码；共享代码保留process/globalThis作为宿主标识，obj.process不误报，不实现通用作用域解析器。
- Runtime.maintenance(now)只委托原健康/额度tick；本机沿原单scheduler驱动，保留15秒检查、60秒额度轮询、首次读取与关闭清理。原core Runtime.open由Node兼容宿主负责维护driver，新openNodeRuntime本身无隐式timer。

## 原始开发结果

| 检查 | 原始结果与处理 | 日志（docs/verification根目录） |
|---|---|---|
| adapter 定向typecheck | 37诊断 → 1诊断 → 退出0 | stage-7-development-adapter-typecheck-{1,2,3}.log |
| 另一次core编译 | 约302行工具输出被截断、未落文件；不能记为完整诊断计数或补造日志 | 仅子Agent工具输出 |
| 全仓typecheck第1轮 | 270诊断；大量为新包wildcard未正确处理带.js路径，修共享映射而非逐项加别名 | stage-7-development-typecheck-1.log |
| 第2轮 | 8诊断，修类型契约与旧budgetViewId兼容导出 | stage-7-development-typecheck-2.log |
| 第3轮 | 原8条修复；删除新转发文件时漏改Node内部相对import，19条缺模块/连带诊断；补全真实调用方 | stage-7-development-typecheck-3.log |
| 第4、5、6轮 | 均退出0；其间只因行为修复/维护接线再检验 | stage-7-development-typecheck-{4,5,6}.log |
| 首轮定向行为集 | 757通过/64失败/61跳过；文件157通过/34失败/37跳过，62.52秒 | stage-7-focused-test-development-1.log |
| 修复后同组行为集 | 821通过/0失败/61跳过；文件191通过/0失败/37跳过，39.79秒。总数仍882，没有减少测试 | stage-7-focused-test-verified-2.log |
| 工作区/单入口/真实15秒维护/额度节奏/A1反例 | 55通过/0失败/1跳过，6文件，16.39秒 | stage-7-focused-test-workspace-verified.log |
| release定向 | 11通过；4份测试spy/mock改为实际local-host依赖路径，保留全部断言和20秒时限 | stage-7-focused-release-verified.log |
| Biome开发与最终 | 18项排序/格式错误修正；最终856文件、0 errors、688 warnings、7 infos，退出0 | stage-7-focused-biome-verified.log |
| size/layers/diff | 退出0；共享生产源105，层级基线0 | stage-7-focused-layers-development.log及定向输出 |

64项首轮失败的主要根因是迁移时将workspaceFiles的exists/write/list也强制canonicalPath，正常缺失的memory/README.md因realpath失败阻断初始化。恢复HEAD原语义：只有readFile做原有根路径/符号链接边界，使用调用方取消context；其他操作继续委托原环境。没有探父链回退或扩大操作边界。model-watch原有直接probeOne调用遗漏新增now参数，恢复Date.now默认值；原断言保留。维护tick无人调用的回归在源码审阅中修复，不能靠停止后台功能满足资源约束。

## root完整gate

源代码冻结后，对新bot-core、runtime-adapter、local-host从空dist重建。原生成物安全移动到ignored `.yonder/stage-7-pre-clean/dist/`，不作为当前产物；最初rm样式清理被工具规则拒绝，改用保留文件的移动后继续，不构成环境阻塞。构建、typecheck、默认测试、lint顺序执行，日志为 `shared-bot-core/stage-7-{build,typecheck,test,lint}.log`。

首轮 build/typecheck 退出0；默认测试2697通过/1失败/112跳过，文件501通过/1失败/67跳过，127.33秒（569文件/2810测试）。lint因test失败未执行。唯一失败是CodeGraph用旧core wrapper作为真实索引夹具，找不到grep定义；只把两份夹具来源改为canonical adapter/runtime，并将调用断言精确改为createGrepTool(host.remoteGrep)，保留2 callers、installExtensions、真实索引、dirty/abort及180秒时限。定向2通过/0失败/0跳过，1.69秒，日志stage-7-focused-codegraph-verified.log；format/diff退出0。没有修改生产算法。

最终完整命令顺序日志为 `shared-bot-core/stage-7-final-{build,typecheck,test,lint}.log`。build/typecheck/lint均退出0；默认测试2698通过/0失败/112跳过，文件502通过/0失败/67跳过，91.73秒（569文件/2810测试）。Biome检查1994文件，0 errors、1315 warnings、34 infos；size扫描908个生产TS、基线0，layers扫描105个共享生产TS、基线0，均退出0。固定基线2660通过/0失败/112跳过，没有可豁免失败；本阶段最终相对基线无新增失败。

没有运行Luna、GLM、worker或生产操作。Luna未测：进程未设置YONDER_TEST_AUTH，仓库默认.yonder/auth.json不存在；未借用其他程序OAuth。指定cloud模型key只核对存在/0600元数据，未打印内容。
