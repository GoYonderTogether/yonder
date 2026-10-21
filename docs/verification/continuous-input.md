# 连续输入、全量队列与中断验收

2026-10-21，用户明确批准共享默认修改及最终回答中断语义，设计见 D49。

## 目标与边界

- 普通渠道（微信两账号、CLI、MCP、飞书及后续 QQ）未指定 busy 时使用 steer。身份、权限、会话划分及 wake=write 不改变。
- 原生 steeringMode / followUpMode 均配置 all；显式 followup 保留。内部已有明确 followup 的后台结果续办/独立任务交接不改成用户插话。
- 普通 steer 在运行工具时等工具结束，生成中取消旧生成、把全部插话并入同一运行；显式 interrupt 还请求取消当前工具。外部副作用不能回滚，不自动重放。
- 已完成阶段气泡保留；中断的生成以 aborted 转录保留，不投递为最终回答。已显示的流式片段无法承诺从平台撤回。
- 不添加第二队列、定时收集窗口或模型轮询。

## 原始问题证据

日用 launchd 主进程 PID 18424，home 为 `/Users/zoran/.local/share/yonder-harness/home`，代码来自本机候选 ee3168c（local-wechat-acceptance），非正式发布包。主人 iLink 已关联 person:owner，输入进入 main/session 2。

2026-10-21 本地 01:45:42、01:45:45、01:45:48 的三条微信消息均路由 busy=steer，第一轮 01:45:51 才结束；却分别产生 run 8800、8805、8806 与三条成功 message.out。没有把未测媒体或第二号隔离记为通过。

## 实现归属

原生改动先在 `/Users/zoran/Documents/github/yonder-pi` 的 `zoran/input-queue-interrupt` 提交 5bba5aedf7cbc57a83e437a491c80cffc2c4f50d，再通过原同步脚本按该 commit 同步。该 fork 提交仅在本机，尚未推送；远程基线仍为 eca1f25。

原生接纳与取消标记同事务：steer 生成中触发取消，工具轮不取消；interrupt 连工具取消。取消处理保留原 run.inputs、工具结果并接续原生 generation；最终提交事务还检查待处理 steer，覆盖生成完成与输入接纳竞争。显式整会话 abort 清除自动接续标记，继续原有取消语义。

Yonder 只配置原生消费数量、映射默认值与 interrupt、抑制 aborted 正文作为最终投递。QQ 任务已收到用户授权的同步消息，确认其向导 DM/群批次显式 steer，群原始输入保持 write；未修改其独立工作树。

## 检查记录

- fork 初次全局 check：缺少新 checkout 的模型数据，同时发现本次 Tx.setTask 类型错误；已改到内部事务接纳入口。
- hydrate 后全局 check：模型目录随上游更新，50 个既有 AI/调用方测试类型引用不再匹配当前目录；最终没有 durable 路径类型错误。全局 check 未通过，不扩展修改模型目录和无关测试。
- fork 聚焦测试首次因依赖未构建导致 2 个套件加载失败、无测试运行；构建原生依赖后曾 36/36 通过。实际开启中断接纳后发现 1 个 ReadAfterWrite，修到接纳前完成表读取；最终 36 通过、0 失败。
- Yonder 首次默认完整检查：build/typecheck 通过，195 通过、23 跳过、0 失败；lint 2 个格式错误已修。
- 新真实模型测试第一轮：1 通过、2 失败（等待渠道工具通知超时；渠道在气泡关闭后不发送工具状态）。改为原生只读会话观察，未修改产品逻辑或放宽断言。
- 新真实模型第二轮：3 通过、0 失败；均为 openai/gpt-6-luna、真实 bash、隔离临时 home。纯文字/工具中 steer/显式 interrupt 均只有一个 run.end、三个实际 inputs；同目标最终答复一次，不重放工具。interrupt 跨两个 owner 来源，同一运行按原契约分别回各来源。
- 最后补充断言：普通 steer 的工具结果 isError=false；interrupt 的工具结果 isError=true。最终真实 Luna 3 通过、0 失败，包含工具成功/取消结果断言；最终 build/typecheck 通过，默认测试195通过/23跳过/0失败，lint 0错误、184警告、1信息。日用安装事实待下方补记。

未验收：微信真人重新连发、飞书客户端实际中断显示、QQ 安装后的同场景、微信媒体及第二账号权限隔离。扫码页面自动刷新是另一项待完成工作。
