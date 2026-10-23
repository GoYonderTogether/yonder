# 官方任务预设验收

2026-10-23，按用户批准的“常驻 Agent + 任务预设”方案实现。复用既有 preset、context、capabilities、offer/search 与 session，不新增运行器。来源与详细原文见 plugins/agent-presets/prompts/SOURCES.md。

## 源码与打包

- 新 init 选择官方 default，并加载 web-tools、生成联网 research 配置；旧 home 不加载 web-tools 仍合法；同名 default 的自定义配置保留。
- 实际插件/内核检查覆盖三套 task contexts 的完整装配、不读取常驻工作区、编码/调研实际工具目录、同一 coding preset 打开 manual session、短提示替换及旧 home 兼容。npm pack dry-run 确认正文、固定原文、来源与三个 MIT 许可均在包内。
- 首次全仓：419 通过 / 1 失败 / 37 跳过（457），97 文件通过 / 1 失败 / 18 跳过。新增测试的全文对比发现任务 context 多保留末尾换行；统一与角色 context 一样 trim 后修复。未弱化正文比较。
- 添加真实验收测试时，build 曾因新测试读取 object 类型事件字段而报两个 TypeScript 错误；按 SDK 实际事件数据类型修正。未改变运行时代码规避错误。
- 修复后 build/typecheck/lint exit 0；默认全仓 420 通过 / 0 失败 / 38 跳过（458），98 文件通过 / 19 跳过。lint 331 warnings、13 infos，无错误。38 跳过需要真实模型/服务等条件，不算通过。

## 真实模型

新增可复跑检查 packages/core/src/prompt/task-presets-live.test.ts，使用 openai/gpt-6-luna、独立 home 和明确测试凭据路径。实际执行编码子任务：编写并运行 Node 脚本读取真实三份任务正文；通用预设在同一个 manual session 连续两轮读取并解释脚本；research 用真实 web-tools_fetch 读取固定上游 LICENSE 并引用来源。原始转录与事件留在该隔离 home 的 evidence.json。首轮真实模型 0 通过 / 1 失败 / 0 跳过，132.54 秒：父测试配置没有 admin，模型自行添加了可选 effort:medium，被已有权限检查拒绝；没有创建子任务。此失败不算编码预设执行失败，也不算通过。保留原始 /tmp/yonder-task-presets-live-A0bs2g/evidence.json。工具的 effort 参数补充字段级说明，并在验收请求中明确沿用预设 thinking、不要传该可选字段；权限未放宽，仍验证同一实际委派。第二轮仍失败：模型先传 sources:[]，随后用一句自然语言冒充来源 ID，校验拒绝且未创建子任务；/tmp/yonder-task-presets-live-s5Nwnn/evidence.json 保留原文。给共享 sources 参数补充“可选、无来源时省略、不传空数组/虚构 ID”的说明，验收父请求固定只传 preset/task。没有放宽 sources 校验或子任务能力。第三轮真实编码任务成功创建并执行脚本，实际结果 general.md=5502、coding.md=9379、research.md=7093；测试却因把 bash 的 JSON 包装字符串当作 stdout 原文而超时（0/1/0，147.58 秒）。按真实工具返回结构解析 output，再对三份实际字符数做完整对象相等比较；保留 /tmp/yonder-task-presets-live-7SRwmm/evidence.json。第二轮原始计数 0/1/0，136.40 秒。第四轮真实模型 **1 通过 / 0 失败 / 0 跳过**，52.92 秒；完整证据 /tmp/yonder-task-presets-live-37JV4h/evidence.json。父 session 2 实际 task_run，coding 子 session 20 使用 write/bash，default 的 session 57 使用 read 并在第二轮保留同一脚本上下文，research 的 session 86 使用 web-tools_fetch。五次 run.end 均为 done；三项实际字符数完整相等。无需真实搜索凭据的公开 URL 路径已测，Tavily search/extract 本轮未测。

未向日用主会话发送验收输入。没有声称一次试跑建立所有模型、浏览器登录、搜索供应商、其他渠道或长期角色学习的质量保证。完整开发者预览的分支收敛、功能验收和文档整理另有范围，不在本任务中批量合并无关分支。

## 0.2.26102307 发布候选

接入已发布主线 a9165fe（0.2.26102306），保留其按需工具恢复与来源说明。仅 CHANGELOG 的并行新增发生合并冲突，双方条目保留。所有 Yonder 包统一为 0.2.26102307；pi-durable 仍为 1.3.0。

最后一次 build/typecheck/lint 均 exit 0；默认全仓 420/0/38（458），98 文件通过、19 跳过，20.90 秒；lint 331 warnings、13 infos。先前相同集成基线和版本元数据检查同样通过；原始失败计数见上文，不用后续成功覆盖。pi 工作区检查通过，权限 self-check 36/0。候选新增 Jarvis/普通常驻角色对 default/coding/research 及连续工作 session 的指引，保留各自身份和长期职责。

正式发布与本机安装结果以 [Release](https://github.com/GoYonderTogether/yonder-harness/releases/tag/v0.2.26102307) 及部署记录为准；此文件的源码测试不是日用渠道行为验收。既有 home 的模型、thinking、个人文件和工具选择不被 init 迁移器覆盖；主人本机的显式 prompt 更新使用私有备份及现有管理接口。

发布准备期间主线再进入 86b5fbb（默认中文与 Asia/Shanghai），已保留并整合；最终基线 build/typecheck/lint exit 0，默认全仓 **423/0/38（461）**，98 文件通过/19 跳过，21.26 秒；lint 331 warnings/13 infos。同一真实 Luna 集成在最终基线再次 **1/0/0**，51.79 秒。此前 420 用例基线记录保留；新增三项来自主线配置/时间检查。effort 字段保留原有 minLength:1，sources 保留 minItems:1/maxItems，不放宽既有校验。

## 正式发布与本机安装

- PR #49 已合并；标签 v0.2.26102307 对应 03ca28bcdd6293be2799bc6a208bcfcd71b51767。PR macOS CI 39917264152 与合并后主线 CI 39917813890 均通过，正式 GitHub Release 已创建。
- 首次安装失败：发布监听先启动自动升级，本轮随后手动执行 update，两个入口共用该版本的 .tmp 目录。手动 clone 失败后清理了自动构建仍在使用的目录，自动构建因源文件消失而失败；旧 06 服务保持 ready。自动作业留下 failed-or-unknown 终态，手动失败日志也保留，未改写为成功。
- 确认两个升级进程均已结束、临时目录不存在后，仅由手动 CLI 再执行一次正式 update。结果 updated=true、verified=true、restartRequired=false；service.info 验证 07 / 03ca28b / ready=true，doctor 无错误。没有把第一次失败当作已经安装，也未通过改安装目录源码解决问题。
- 本机显式迁移先备份，给既有 default 保留全部旧模型/thinking/工具/权限，仅补任务 context 与插件选择；research 选用 web-tools。两位实际活跃常驻 Agent 只补新任务分工段落，agent.yaml 逐字保持；已归档 Agent 继续归档，个人历史保留。
- 安装版实际装配验证覆盖 6 个活跃 profile、3 个任务预设，身份隔离与 research 的六个只读/网络工具匹配；无真实模型消息发送到日用渠道。私有文件、转录和备份仅保存在本机，没有提交仓库。

安装器缺少跨 CLI/发布作业入口的互斥是本轮发现的既有缺口，已列入 status；此次采用一个执行者完成恢复，没有扩大为安装系统重构。后续更新应先查发布作业状态，避免自动升级和手动升级同时进行。
