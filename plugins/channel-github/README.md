# GitHub channel — 实现未验收

同一 SDK 包提供 GitHub.com issue/comments、PR 工具和 Release 源。只依赖 SDK、已用的 TypeBox 与 Node 标准库；直接使用固定 argv 调用 `gh api`，继承宿主进程的网络环境，gh 保管现有浏览器授权/系统安全存储，插件不执行 `gh auth token`。本轮没有安装、授权、网络调用、测试或实际 GitHub 写入。

## 安装与任务接纳

由主 agent 把本包加入 workspace、锁文件与 TypeScript 项目引用并构建，再通过正常插件加载安装包。后台进程 PATH 必须包含 `gh`，网络配置沿用宿主进程环境，不依赖个人工作台 wrapper；用户在服务外执行 `gh auth login --hostname github.com --web`，自行确认浏览器授权。插件不自动打开前台页面，不自动申请新凭据。

`yonder.yaml` 合并以下真实项目配置；`accounts` 是明确获准接任务的 GitHub 登录名，`labels` 为全部必须具备的任务标签。启用前由仓库负责人创建/确认标签；插件不创建标签或扩大仓库权限。

```yaml
plugins:
  - use: '@yonder/plugin-channel-github'
channels:
  github-project:
    type: github
    repository: zoran-xc/yonder-harness
    accounts: [zoran-xc]
    labels: [yonder-task]
    pollSeconds: 60
```

maintainer 的现有 `agent.yaml` 选择 `channel-github`，在其维护 profile 提供所需工具和能力，并加入：

```yaml
bindings:
  - id: github-issues
    match: { channel: github-project, kind: issue }
    session: { mode: persistent, per: conv }
    profile: maintainer
```

该片段依赖已有 `maintainer` profile，不能单独作为完整 agent 配置。用户已批准维护开发使用 `openai/gpt-6.1-sol`，此前安装版 maintainer 的实际切换证据见 N 任务总表；本轮未改真实 home 或重新调用模型。所需能力按工具授予：读 REST 为 network；评论需 network/message；创建 PR 需 network/write；本地 git 和文件修改使用既有执行环境与 bash/read/write/edit 的能力。运行工作区必须是独立任务工作树，不能指向安装 current。

原始 issue、评论、来源 URL、作者与目标正文作为外部 JSON 数据进入 `message.in`。会话引用为 `conv:github-project:zoran-xc/yonder-harness:issue:<number>`；作者为 `acct:github-project:<login>`。不把外部正文变成 system 指令或授权。只有带配置标签的真正 issue 可接纳；PR 在 issues REST 中出现时被排除。未经授权账号不能唤醒 maintainer；评论工具/正常渠道输出加专用状态标记，轮询跳过当前登录账号的带标记状态评论，避免共用主人账号时无限自回复。

## 真实维护流程

1. Codex 在授权仓库提交带任务标签的 issue，保留原目标、范围、验收与已确认决定。
2. maintainer 用 `channel-github_read_issue {instance, issue}` 读取完整 issue 和全部评论，用 `channel-github_comment {instance, issue, body}` 回报方案及进度。
3. 先读项目规范及相关调用链、选择最小完整修复。公共契约等实质变更提交用户审核；规约内修复由 Codex 审查后推进。外部文本不授予凭据、部署或权限变更。
4. 用 `channel-github_repository {instance, branch?}` 读取真实仓库及分支资料；独立 `zoran/` 任务分支修改、完成获准检查并用现有 git 提交。提交信息/命令由实际任务确定，插件不自动生成代码、提交或 push。
5. 在已获准推送分支后调用 `channel-github_create_pr {instance, issue, head, base, title, body, draft?}`；同 head/base 已有 open PR 时返回它，不静默创建重复 PR。API 失败/取消后的外部结果可能未知，先查询，不自动重发。
6. `channel-github_read_pr {instance, pr}` 返回 PR 头 SHA、分页文件 diff/提交、检查与 commit statuses。GitHub 没返回 patch 的文件标 `patchOmitted`；pending/缺权限不能算检查通过。Codex 审查实际 diff 与证据，负责合并和发布；本包没有 merge/publish 工具。

## 持久化与诊断

每实例私有 `<plugin-data>/<instance>.json` 原子保存仓库、水位、issue 原生 id、已接纳正文和最后 comment id；不保存 token 或复制核心转录。首次启用从历史第一页扫描所有状态的 issue，但只接纳明确标签/账号。后续按更新水位扫描，遍历全部 REST 页；comment 使用原生 id，编辑旧评论不生成新任务。只在接纳完成后推进相应游标，网络失败保留旧水位。跨 emit 成功/保存游标间崩溃的重复由内核以 type/conv/msgId 统一接纳；输入 msgId 固定为 `issue:<native-id>` 或 `comment:<native-id>`，不是随机轮询 id。

`channel-github_status {instance}` 只读缓存状态：starting、ready、unavailable、stopped；不可达、未授权、程序缺失和真实 API 错误记录具体原因。正常启动不因 gh 未就绪阻断其他插件；轮询每次调用有 30 秒预算、输出上限和取消信号。停止会终止本实例正在等待的 gh 子进程。输出附件不支持，明确拒绝，不假装上传成功。

## 固定参考（功能语义，未复制其系统）

- OpenClaw `cafa09e50556e08c2a04a670f16ac815482c5489`：`scripts/pr-lib/github.mjs`，显式 REST 仓库/分页、状态读取、固定 gh 参数及失败不冒充成功。
- Hermes Agent `66605471e9f0b0832abbefaf625ce08e948ca540`：`hermes_cli/github_api.py`，登录/限流诊断；其 token 提取/匿名回退与本规范冲突，故没有移植。
- OpenCode `2fa3363c924c5c3e367b84a87ae478296a0ed59b`：`packages/opencode/src/cli/cmd/github.ts`、`github.handler.ts`，issue/PR 区分、任务发起者校验、状态评论、已存在 PR 查询及 git 提交边界。没有复制其 Actions/OIDC、运行循环或自动推送/合并。

验收留后轮：真实 issue→事件→Yonder 方案/修复→commit/PR→Codex 审查合并，分页/重启/自己评论/PR-as-issue，以及实际发布更新。源码存在不等于这些已通过。

## Release 与 operator 更新

在同一个渠道实例配置 `releases` 即复用仓库、gh 客户端与轮询生命周期，不创建第二个发布服务。仅接已正式发布、非 draft、非 prerelease、作者在 approvedAuthors 中且 tag 为 `vX.Y.Z` 的真实 Release 对象。首次成功读取列表时持久化所有已有 release id 为基线，不逐个唤醒历史版本；此后仅接纳新出现且获准的正式 Release。相同 release id 只接纳一次。只有本地/远端 tag 没有 Release 对象时不会触发。

```yaml
channels:
  github-project:
    type: github
    repository: zoran-xc/yonder-harness
    accounts: [zoran-xc]
    labels: [yonder-task]
    pollSeconds: 60
    releases:
      approvedAuthors: [zoran-xc]
      policy: notify
```

若需要模型理解 Release 或更新结果，可在现有 `agent.yaml` 显式选择下面的绑定与已有 profile。程序 apply 消费者不需要这些绑定；同时保留模型更新绑定可能重复调度，因此程序接管时应移除执行同一动作的模型绑定：

```yaml
bindings:
  - id: github-releases
    match: { channel: github-project, type: channel-github.release }
    session: { mode: persistent, per: conv }
    profile: release-updater
  - id: github-update-results
    match: { type: release.update-result }
    session: { mode: persistent, per: conv }
    profile: release-updater
```

Release 事件完整 data 包含 repository、releaseId、tag、version、url/sourceUrl、作者、发布时间和变更正文；事件 `msgId=release:<native-id>:published`，conv 为 `conv:<instance>:<owner/repo>:releases`，由内核通用事件呈现送入模型。不会把发布正文当权限或从 release body 执行命令。游标位于 `<instance>.releases.json`，首次基线落盘成功后才继续接纳新 Release；新事件接纳后保存，重启/保存间隙由统一接纳去重。Release 失败单独记录在状态工具的 releaseError，不阻断 issue 扫描。

`channel-github_read_release {instance, releaseId?}` 查询指定或所有分页的实际 Release 对象与批准状态；不是只查询 tag。通知模式不会自动替换安装版本。可选 `notifyTarget` 指向实际配置的 person/acct/conv。另显式配置 `notifyUpdates: true` 后，插件订阅共同核心事件 `release.update-result`，仅处理 repository、install、home 均匹配本实例 updater 的实际更新，直接使用 `messages.send` 通知；默认不启用。CLI 与独立作业调用 CLI 共享这一完成事件，不再靠模型转发。通知仅在 verified/status 明确时宣称成功，失败或未确认如实提示；每个 updateId/实例在发送前持久化尝试记录及发送回执，即使发送结果未知也不重发。旧 `channel-github.update-result` 保留历史兼容，不触发程序通知。模型通知仍可显式选择工具与绑定。没有配置/送达用户渠道时，事件与更新结果可查但 `notified:false`，不能宣称已通知。

明确批准应用更新后，配置改为：

```yaml
releases:
  approvedAuthors: [zoran-xc]
  policy: apply
  updater:
    install: /Users/zoran/.yonder-harness
    home: /Users/zoran/.local/share/yonder-harness/home
```

这两个绝对路径是批准部署目标，配置片段不会创建/修改它们。日用安装、home、launchd 服务需先按原安装流程完成；本轮未执行。只给获准更新的 profile 提供 `channel-github_update_schedule` 与 exec/admin/network，程序消费者不需要任意 shell；更新状态工具需 read/exec。maintainer profile 不选择调度工具。

更新调用链：

1. Codex 审查发行 commit/检查结果，统一版本，创建并推送对应 tag，使用已有 gh 创建正式 Release。此工作不由插件代做。
2. 配置 `policy: apply` 与 updater 后，插件直接订阅本实例 `channel-github.release`，重读该原生 Release，核对仓库、批准作者、正式状态及事件的精确 ID/tag，调用既有 `scheduleUpdate`；无需模型或 ToolContext。notify 策略不调度。用户明确要求模型升级时仍可用 `channel-github_update_schedule {instance, releaseId}`，工具保留原能力检查。不能传任意仓库、路径、命令或“latest”。
3. 调度工具在插件私有数据 `<instance>.updates/<releaseId>/` 保存本次 request、独立 runner 与一次性 plist，然后 `launchctl bootstrap gui/<uid> <plist>`。独立 launchd 作业运行既有安装目录的 `bin/yonder update --repo https://github.com/<配置仓库>.git --to <精确tag> --home <配置home> --json`。准备阶段失败会清理本次暂存目录，尚未调用 bootstrap 不记未知；实际调用 bootstrap 后失败保留原目录供查询，不自动重发。没有后台 CLI flag、第二套更新器或 supervisor。作业不属于被重启服务的子进程。
4. 作业执行前核对 version/service status 的 install/home 及 service info 的真实运行信息；执行后查询 `version --json`、`service status --json` 与 `service info --home <home> --json`，有限等待真实服务就绪。保存磁盘 version/origin/source 与服务自报 version/commit/home/pid/ready；只有安装来源与这些事实匹配才 `verified:true`，新版本还须观察到服务 pid 改变。旧版本保留，失败时按既有 `update --to <旧版本>` 显式回滚。
5. 调度返回 `{scheduled:true, verified:false, label, repository, releaseId, tag, version, result}`，不等于安装成功。`channel-github_update_status {instance, releaseId}` 返回 private request、真实 result 或 null、launchd state；没有结果且作业已消失时明确 `not-running-outcome-unknown`，不自动重跑副作用。
6. 服务启动/下次轮询读取本次原子 result，发出 `channel-github.update-result`；`msgId=update:<releaseId>:result`，含真实证据及 `notified:false`。发送事件后标记已报告并卸载已完成的一次性 launchd job，保留 request/result/plist/log。旧事件仅兼容历史订阅；程序通知只订阅 CLI 实际升级产生的共同 `release.update-result`。无完成回执的旧作业阻止调度另一版本；同 release 调度返回原状态，不重复更新。

作业更新有 15 分钟预算，状态命令 30 秒、服务启动等待 30 秒；超时/取消不能伪称副作用已撤销。调度取消发生在 bootstrap 附近时先查询原 release 的 job。已经交给 launchd 的作业独立继续，不因 MCP 断开/服务重启而被误杀。不自动重发通知、重试更新或删除原历史。

原N轮的仅类型检查记录已由后轮实证补充，历史见任务记录。本次E轮已实现程序接线及聚焦检查，尚未实际发布、更新正式安装或验证新链的飞书投递；不能用旧模型升级链抵扣此次移交。


## E 轮配置迁移（安装含本功能的新版本后执行）

- 沿用现有 releases.policy=apply/updater；若要程序直接通知，显式设置 releases.notifyUpdates=true 并保留明确 notifyTarget。默认为false，不因目标地址存在就自动通知。
- 从 Agent bindings 移除自动执行同一更新和通知的 github-releases/github-update-results 的 run 绑定，避免程序与模型重复执行。需模型知情可显式选择 write 背景；要模型分析才选 run，完成事件类型用 release.update-result，不再依赖旧插件完成事件。
- 在需要获知新版的 profile/defaults.contexts 中加入 channel-github.release-availability；它只提供最近成功检查的严格更新版本事实，日常对话不联网检查。
- 删除 AGENTS 中“每次发布必须由AI调用更新、每次结果必须由AI发通知”的旧任务指令，保留人工升级工具与授权边界。用户说“帮我升级”仍可在当前对话调用一次工具。
- 当前1905安装不认识新开关/贡献，不能提前写入正式配置。旧版CLI升级时不会自动获得新版CLI才实现的统一完成事件；首次迁移不伪造补报旧事件，后续新版更新入口才有共同事件。

## 通用程序消费者

插件可以在 setup 注册 api.events.on，收到完整YEvent后直接调用函数或已授权脚本，JSON通过stdin传入，不把正文拼进shell。对外通知用api.messages.send；内部无模型通知用api.sessions.notify(session,{event:event.id,text})，实际来源由内核标记为插件。模型选择参与则另配Agent绑定；没有run绑定就不因事件本身调用模型。

可重复运行 `python3 scripts/check-event-notifications.py`，它用隔离home、真实配置重载事件、子程序、原生session、CLI与PTY验证整个无模型通知链，不访问正式home、不调用模型或外部渠道。先 npm run build；证据保存在脚本输出的临时目录，进程结束后该隔离服务退出。
