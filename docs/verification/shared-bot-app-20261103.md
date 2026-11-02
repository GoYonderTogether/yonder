# 共享Bot客户端：阶段9验证

源基线为Yonder阶段8 `4ac172d5`，Cloud阶段8 `eed0b17`。阶段9只改两份MessageContent类型、实际Chat/History/Composer与其原有组件测试，以及Cloud现有Install的/download路由别名。不新增页面、浏览器框架或依赖，不改模型/Worker/Docker/安装/发布。

## 实际行为

- MessageContent新增server/worker error与按钮级link。app实际Bubble中error在全部hooks之后单独返回role=alert/text-danger，无普通气泡；历史预览及列表显示错误正文，普通消息保持原样。
- action自身link优先，缺省回退卡片级link，最后沿原#回退。Cloud同字段/SSR已在此前接线，本轮再次验证。
- 无设备Agent按实际online显示cloud不可用；placeholder不再说小未只能引导，也不承诺上线后送达。设备Bot原离线排队文案与行为保持。
- Cloud/download与/get都复用已有Install，不造下载页面或改安装器。

## 组件聚焦与原始失败

子Agent聚焦3文件：socialChat.test.tsx、socialHistory.test.tsx、composerOffline.test.tsx（均在apps/app/test）。首轮13通过/1失败，1.44秒；SSR新增Composer断言缺location全局，测试内设置实际会读取的location.search后，14通过/0失败，1.24秒。日志stage-9-app-focused-first.log、stage-9-app-focused-rerun.log；原工具没有保留完整命令，不补造命令历史。独立app workspace typecheck通过。

SSR包含真实Bubble的错误无气泡、实际preview正文、两个action链接优先及旧整卡link回退。它不是实际模型调用，也不作为阶段10卡片工具通过的证据。

## 实际Chrome页面

按web-verify-local-chrome技能，用独立临时profile的Chrome headless/CDP、临时真实PG/Redis/server/owner/DM与两套本机Vite运行页面。VITE_API=http、YONDER_SOCIAL指向本轮本机反代，没有运行会SSH zeth-root的live-preview脚本。未安装Playwright/Puppeteer或新验证框架，未新建仓库脚本/产品页；inline驱动不作为npm test的一部分。

[脱敏页面观察](shared-bot-app-browser-20261103.json)记录：server真实产生“云端 Bot Worker 不在线”，/c/:id实际页面role=alert、text-danger，computedColor为rgb(180, 52, 44)，自身及祖先均无普通气泡背景类；Composer为“云端 Bot 当前不可用”，列表preview含原错误。Cloud/get与/download都显示已有Install的相同标题、tabs与返回链接。

首次浏览器断言误选左侧搜索input，修正为textarea后通过；初次失败仅工具输出，无独立日志，不冒称有文件。成功原始JSON来自/tmp/stage9-browser-check.log，现已归档上述文件。cookie/key仅临时私有文件或进程内，未进输出。没有截图、桌面焦点或用户profile操作；临时PG/Redis/server/反代/Vite/Chrome均关闭。这里只验证本机运行页面，未验证生产、安装客户端或真实下载/设备绑定操作。

## Root完整gate

| 检查 | 原始结果 |
|---|---|
| Yonder build/typecheck | 均退出0 |
| Yonder默认test | 2707通过/0失败/112跳过；506文件通过/67跳过，573文件/2819测试，107.08秒 |
| 首轮Yonder lint | 1error：socialHistory.test.tsx import排序；0新增行为错误，1322warning/34info |
| 仅排序import后lint | 退出0，2023文件，0error/1322warning/34info；size923/layer108、基线0 |
| Cloud root/server build/typecheck | 均退出0 |
| Cloud完整server tests | 206通过/0失败/0取消/0跳过/0todo，22 suites，110.256秒 |
| Cloud实际MessageBubble SSR | 3通过/0失败/0取消/0跳过，0.663秒 |
| 两仓git diff --check | 通过 |

Yonder日志shared-bot-core/stage-9-app-final-{build,typecheck,test,lint}.log，排序后为stage-9-app-final-lint-corrected.log，唯一错误定位stage-9-lint-errors.log。只修测试import顺序，未改产品行为/断言，不重复已成功的全套测试。Cloud日志shared-bot-core/stage-9-alias-{cloud-build,cloud-typecheck,server-build,server-typecheck,server-test,render-test}.log。Cloud无lint脚本，不冒称执行不存在的命令。所有原始失败保留。

A7的模型/后端边界沿阶段8独立证据，本轮补齐app实际组件/浏览器呈现；A8真实官方卡片工具仍待阶段10。没有真实Luna新调用、push、部署、生产访问或设备工具验收。
