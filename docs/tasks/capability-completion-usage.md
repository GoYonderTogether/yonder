# C0–C6 操作入口与交付边界

**2026-10-18：源码实现未验收。** 全仓 `npm run build`、`npm run typecheck` 通过，只证明源码组装与类型关系；本轮没有新增/运行测试、真实模型/浏览器/桌面/渠道调用、安装切换、push 或发布。日用 0.1.4 不包含本轮源码，不能用日用 `yonder` 验证本轮新命令。

以下是已接线命令的使用说明，**本轮没有执行这些操作**。将 `<home>`、`<agent>`、`<session>` 等替换为实际值；源码入口为仓库根目录的 `node packages/cli/dist/index.js`。安装后才可使用对应版本的 `yonder` 简写。

## 1. 查看配置和历史

```sh
node packages/cli/dist/index.js plugins list --home <home> --json
node packages/cli/dist/index.js plugins show browser-skill --home <home> --json
node packages/cli/dist/index.js models list --home <home> --json
node packages/cli/dist/index.js inspect --agent <agent> --profile <profile> --home <home> --json
node packages/cli/dist/index.js skills --agent <agent> --home <home> --json
node packages/cli/dist/index.js sessions list --home <home> --json
node packages/cli/dist/index.js sessions show <session> --home <home> --json
node packages/cli/dist/index.js events --type run.end --limit 100 --home <home> --json
```

- 插件静态配置/声明、运行中已加载贡献与外部服务就绪是不同信息；外部状态使用各插件 status 工具。离线查询不声称服务已加载。
- models 是模型目录，不是账号权限清单。inspect 显示下次运行的有效配置；在线查询同时区分已有运行快照，不输出凭据或完整原始配置。
- sessions show 是有限页转录；长历史通过既有 MCP `sessions_transcript` 的 from/limit 分页读取。run.end 是模型终态，message.out 是送达事实，不互相替代。

## 2. 加载官方插件与选择工具

已接入 workspace 的五个包：

| 包 / 插件 id | 实现内容 | 接入说明 |
|---|---|---|
| @yonder/plugin-browser-skill / browser-skill | 七个 BrowserSkill 工具、连接诊断、启动本地 daemon、扩展配置引导、浏览器操作 | [README](../../plugins/browser-skill/README.md) |
| @yonder/plugin-codex-tools / codex-tools | 外部 Codex app-server 的 Computer Use JS/状态/重置与 hosted search | [README](../../plugins/codex-tools/README.md) |
| @yonder/plugin-web-tools / web-tools | Tavily Search、Extract、公开 GET 与正文提取 | [README](../../plugins/web-tools/README.md) |
| @yonder/plugin-channel-github / channel-github | issue/comment 接纳、PR 读写、Release 事件及服务外更新 | [README](../../plugins/channel-github/README.md) |
| @yonder/plugin-channel-feishu / channel-feishu | 飞书/Lark 多实例、消息/多媒体/卡片、CardKit 流式和按钮回调 | [README](../../plugins/channel-feishu/README.md) |

```sh
node packages/cli/dist/index.js plugins add @yonder/plugin-browser-skill --home <home> --json
node packages/cli/dist/index.js plugins add <本地插件目录> --home <home> --json
node packages/cli/dist/index.js plugins remove <插件id> --home <home> --json
```

add 只加载本地/已安装包，不下载 npm/Git 包。它验证完整候选配置后写入 yonder.yaml；源码/插件配置变更需要服务外重启。remove 有引用时拒绝，先解除 profile/preset/channel/env 等实际引用；不删除插件源码、私有数据和历史。

加载不等于 agent 选用。编辑既有 agent.yaml/profile 的 plugins、tools、skills、capabilities，并按原流程校验/重载；不在所有 agent 上自动启用。浏览器任务推荐选择 browser-skill 及同名 skill；本轮没有更改 init 的原默认配置或真实 home。GitHub/飞书的渠道实例、绑定和凭据引用按各包 README 配置，不能只 add 包就宣称渠道已接通。

Codex 和 gh 直接继承宿主环境，需在服务 PATH 中可用；不依赖个人 agent-network wrapper。BrowserSkill 默认不自动启动 daemon；agent 用 setup 查询后显式启动/索取配置帮助。Tavily 凭据经既有 credentials 引用解析，不读取其他项目密钥。

## 3. 本地 Skills 管理

```sh
node packages/cli/dist/index.js skills show <技能名> --agent <agent> --home <home> --json
node packages/cli/dist/index.js skills add <含SKILL.md的目录> --home <home> --json
node packages/cli/dist/index.js skills add <含SKILL.md的目录> --agent <本机agent> --home <home> --json
node packages/cli/dist/index.js skills remove <技能名> --agent <本机agent> --home <home> --json
```

不带 agent 写 home/skills；带 agent 写该本机 workspace/skills。同名拒绝覆盖；remove 只删除所选管理位置的直接目录，不删除导入来源或插件 skill。show 复用原解析、选用与遮蔽规则；插件来源显示真实 plugin id。远程环境导入不在本轮范围。

## 4. 发任务、带附件、被动观察

```sh
node packages/cli/dist/index.js chat --home <home>
node packages/cli/dist/index.js sessions open <preset> --keep-open --home <home> --json
node packages/cli/dist/index.js sessions submit <session> --text '读取这些附件并处理任务' --attachment <图片路径> --attachment <文件路径> --home <home> --json
```

任务仍经过既有 pi 队列、busy/steer/followup 与权限边界。手动关闭任务可继续对话；`sessions abort` 真正取消，`sessions close` 关闭，不用于观察进度。CLI 读取本地文件实际大小/类型；图片经原生解码与请求限制处理，不把任意文件宣称为模型已读正文。TUI 拖拽/剪贴板图片未新增。

MCP 提交后可用原事件/会话 id 查询，不因客户端超时重新发任务。新增服务端 MCP 工具 `channel-mcp_sessions_watch` 共用 TUI/控制面的被动观察源，支持有限等待与标准 progress 通知；缓冲被截断时明确标记。观察不唤醒模型、不抢 ask 结果，断开不取消任务。客户端不支持通知时查询 events/transcript；不保证重放所有未持久的流式片段。

## 5. 维护与发布链

maintainer 接 GitHub issue 后用真实工作树和既有工具设计、修改、commit、在授权推送后创建 PR；Codex 仍负责审查/合并/发布。用户允许维护开发使用 openai/gpt-6.1-sol，hosted search 自己的模型选择与之独立。**本轮新增代码由 Codex 与三个 Sol sub agent 实现；旧 N06/N07 的 Yonder 原作者记录保留，不冒称整轮自主实现。**

Release 来源要求正式 Release 对象、批准作者与精确版本 tag。默认 notify 不更新。明确批准部署并配置 apply 后，operator 调度一次性独立 launchd 作业，调用原安装器；插件不在承载自身的服务进程内替换系统。scheduled 不等于更新成功；结果须核对 version、commit、home、安装路径与服务 pid。没有通知渠道时保留 notified:false，不宣称已通知用户。

## 6. 留待下一轮的实际验收与已知问题

- N09：恢复/崩溃断点、steer/followup、父子并行与取消、权限交集、投递不确定窗口、配置和附件组合；补充必要测试并修复发现的 bug。
- N13：真实飞书租户授权、文字/卡片/媒体客户端效果、按钮回调、断线、取消与流式收尾；通过 Computer Use 看真实客户端。
- N14：独立安装、BrowserSkill 扩展、Codex 桌面/hosted search、Tavily、GitHub issue→Yonder 修复→PR→审核→正式 Release→operator 更新整链。
- D29 之前没有原生结束回执的历史，不能伪造整轮结束来源/用量；不据此自动重新运行。回执查询沿用历史扫描，数据量很大时才根据真实瓶颈优化。
- 新图实际字节/原生解码及历史请求限制已经接线；排队中配置变化、不同模型图片限制等组合没有真实验证。外部程序版本、浏览器扩展、账号/权限和供应商协议也没有本轮运行证据。
- U05 交接提交 3d31601；其既有检查不在本轮重跑，视觉验收和日用安装仍待用户确认。

工序和贡献记录见 [C0–C6 计划](capability-completion-plan.md)；原始失败和跳过继续留在 N/U 任务。到 C6 停止开发，交用户审核后再放行下一轮。
