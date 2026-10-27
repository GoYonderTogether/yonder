# 任务看板子任务重复显示修复

2026-10-26。基于正式 `v0.2.26102512`，独立分支 `zoran/task-board-acceptance`。

## 复现与修改

正式服务的真实账本经 `tasks_show(target:web/json)` 发布后，浏览器总览把分组内的平铺任务和每个父任务的 children 同时渲染。子任务因此出现两次；跨状态子任务还会同时出现在父任务分组和自己的分组，分组计数与可见行数不一致。

只修改 companion 总览的投影：同状态分组内仅从根行递归渲染，同组子任务保留缩进；其他状态的子任务只在自己的分组出现。详情仍读取和呈现全部子任务。账本、TaskBoard、状态、计数、投递和其他渲染器不变。

## 实际检查

- `npm ci --offline`：exit 0。
- 新增断言接到现有真实 SQLite/插件/服务/Chrome 用例。修改产品前：3 passed / 1 failed；失败为子任务 DOM 数量 `2 != 1`。
- 修改后同一文件：4 passed / 0 failed / 0 skipped。断言覆盖跨组仅一行、同组仅一行且仍嵌套，沿用原详情、刷新与滚动保持检查。
- `npm run build`、`npm run typecheck`、`npm run lint`：均 exit 0。lint 0 errors / 481 warnings / 14 infos。
- 默认全套仅运行一次，持有共享重测锁并指定 `--maxWorkers=4`：757 passed / 0 failed / 40 skipped（797）；118 文件通过 / 19 跳过（137）。本次原始跳过数为40，不沿用先前发行记录的39。
- `git diff --check`：exit 0。

独立 companion 预览使用本分支构建的页面，后台从生产 `tasks_show` 发布的只读 HTTP 端点取真实数据，没有复制或伪造任务。实际 Chrome DOM 读回31行、31个唯一任务、重复ID为空；四组可见行数与标题计数一致。保留浏览器截图及 JSON。首次截图发生在异步加载前，另存为 loading，不以空白加载截图作为验收。

本机完整证据在 `/Users/zoran/Documents/yonder-harness-acceptance-20261026/`：`production-board-before.png`、`board-after.png`、`board-browser-check.json`、`board-regression-before.log`、`board-regression-after.log` 与 `board-{build,typecheck,full-test,lint}.log`。该目录含私有历史，未放入Git。

## 边界

没有发版、安装本地beta、替换或重启正式服务。生产仍运行原正式12版，因此生产页面仍有旧显示缺陷；本修复仅完成源码、自动检查和真实生产数据驱动的独立浏览器验收。未宣称原生桌面窗口、飞书客户端或其他显示设备已应用修复。没有改动模型行为，未为此重复运行真实模型套件。
