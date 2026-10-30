# channel-card

官方名片渠道 `@yonder/plugin-channel-card`，仅使用 SDK；一个设备令牌和一条 WS 服务本实例全部启用 Agent。

在现有配置中加入插件 `@yonder/plugin-channel-card`，配置渠道 `type: card`。
渠道字段：`endpoint` 默认 `https://yonder.zethai.cn`；`device.kind` 为 laptop/desktop/server，默认 desktop。设备名取 hostname。配置不含令牌。

用 `yonder channels login <实际实例>` 取得网页确认链接。人登录网页确认后，后台每两秒 poll，成功即登记 Agent 并连接。不自动打开浏览器。令牌私有保存在 `<home>/.yonder/plugins/channel-card/<instance>.json`，目录 0700、文件 0600，绑定 endpoint origin。setup 不联网。

网页发起邀请时，已登录主人点击“添加设备”获取十位数字一次性邀请码（十分钟有效），执行 `yonder channels login card --verify-code <code>` 即兑换并连接，无需二次确认。返回 connected / already-connected / invalid-code / retry-later；不记录邀请码或令牌。原网页确认流程保留。

每个 Agent 仍须在自己的 agent.yaml 绑定该渠道，目标字段不绕过绑定。引用含 Yonder Agent id：`conv:<instance>:<agentId>:<platformConvId>` / `acct:<instance>:<agentId>:<platformAccountId>`。kind 为 dm/group/notice，mentioned 直接取后端字段。不会自动把任何平台账号关联主人。

启动、确认后和每十分钟同步 id/name；后端登记为 upsert，省略的 Agent 不会被远端删除，本地不再接纳其输入。同步重连刷新 hello 订阅；断线指数退避 1–30 秒。先 io.emit 接纳，再 ack，后端游标补收。

自动回复或 `message_send` 经 send 发 Markdown；acct 先解析幂等 DM。仅匹配 ref 的 sent 才成功，15 秒超时或发送后断线返回 uncertain，绝不自动重发。真实后端目前错误只有 `{error}`，无法关联请求，等待超时。首版不提供上传附件或流式输出，入站 image/file 转附件。

工具 `channel-card_card_push({instance,title,markdown,display?})`：write + network，当前 ToolContext.agent 决定身份，不接受其他 agentId；display 是 `{kind:'html'|'svg',source}`。工具只起草自己的名片，发布由人在网页完成。

测试：`npx vitest run plugins/channel-card/test`。protocol.test.ts 为 loopback 协议契约替身，非模型替身；real-backend.test.ts 启动 sibling server 的真实实现和临时 PostgreSQL/Redis，无 sibling 或本地二进制时明确跳过。所有测试仅 loopback，无生产访问、无模型。实际验收见 docs/status.md。

## 给 Agent 的连接提示词

以下模板供网页 `/get` 和“添加设备”对话框原样使用，网页将 `{CODE}` 替换为刚生成的十位数字邀请码、`{ENDPOINT}` 替换为该网页服务的 origin。**待完成：包含此插件及邀请码兑换功能的官方发行版**；当前分支源码不等于已发布或已安装。

```text
请把这台设备上的 Yonder 连接到我的名片服务 {ENDPOINT}。我已登录网页并发起邀请，无需再打开确认页。

1. 先执行 yonder version，确认实际版本和 home。如果找不到 Yonder，请告知我安装入口是官方仓库 https://github.com/GoYonderTogether/yonder 的 docs/spec/09-cli-release.md §3；安装必须固定到已审核的官方 release。不要编造安装命令或版本，不要把开发分支当作官方发行版。包含 card 插件及邀请码兑换功能的官方发行版仍待发布；若当前版本不含这些功能，请明确说明并停止，不消耗邀请码。
2. 执行 yonder plugins list、yonder channels list，核对实际加载状态。若 card 尚未启用，告诉我以下真实启用步骤，并在当前 home 保留已有配置地完成：用 yonder plugins add @yonder/plugin-channel-card 添加已安装发行包（该命令不下载包）；在 home/yonder.yaml 的 channels 中加入 card: { type: card, endpoint: "{ENDPOINT}" }。插件加载项以 yonder.yaml.plugins 为准，应有 use: "@yonder/plugin-channel-card"，不要重复添加。yonder.yaml 的插件和渠道变更需要重启；用 yonder doctor 校验，已安装服务用 yonder service restart，手动运行的 harness 按原方式重启，再核对运行中的渠道。不要启动第二个内核。若已有 card 实例指向其他 endpoint，不要覆盖或替换其令牌，请报告冲突。
3. 连接会登记当前实例全部启用的 Agent。消息仍需各 Agent 的 agent.yaml 中已有的 card 渠道绑定才会唤醒；不要擅自扩大绑定或主人身份关联。若要使用名片草稿工具，需在相应 Agent 的 defaults.plugins 或实际 profile.plugins 中保留原列表并加入 channel-card（profile 数组会整体替换 defaults），工具选择须包含 channel-card_card_push，且该 profile 须具有 write、network 能力；无需为设备登录开启全部工具。
4. 执行 yonder channels login card --verify-code {CODE}。邀请码是十位数字，十分钟有效且只能使用一次；不要在回复或日志中回显邀请码，不要打印任何 token、凭据或私有文件内容。
5. 如实报告命令返回的结果：connected 为兑换成功并已登记 Agent、发起连接；already-connected 为本设备已连接此服务且未再次兑换；invalid-code 请我在网页重新添加设备获取邀请码；retry-later 请稍后重试。不要把契约测试或命令返回当作网页消息收发的真实验收。
```

方式 A（浏览器通过 URL scheme/loopback 唤醒本地 Yonder）未实现，需要维护者批准内核设计。

## 显式启用已有 Agent 的群聊

安装更新后运行：

```sh
node <install>/current/plugins/channel-card/dist/setup.js upgrade-groups --home <home> [--agent <id>]
```

只处理已有 card 绑定的本地 Agent。缺少群绑定时，备份 agent.yaml 并原子写入独立 card-group 只读配置档：三个 conversation 查询工具、read/grep、message_send、parent_ask；persistent per:conv、wake:mention、reply:none、busy:steer。普通消息旁观，被 @ 时运行；持续参与仍沿已配置 social，不新增队列。自定义群绑定或同名配置档保留，重复执行不修改。群公开发言用 message_send，普通回复不强制引用。运行后用 doctor 检查并重新加载配置；平台发送成功与页面显示分开验收。
