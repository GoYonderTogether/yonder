# GitHub channel — 实现未验收

同一 SDK 包提供 GitHub.com issue/comments、PR 工具和 Release 源。只依赖 SDK、已用的 TypeBox 与 Node 标准库；使用固定 argv 的 `agent-network run -- gh api`，gh 保管现有浏览器授权/系统安全存储，插件不执行 `gh auth token`。本轮没有安装、授权、网络调用、测试或实际 GitHub 写入。

## 安装与任务接纳

由主 agent 把本包加入 workspace、锁文件与 TypeScript 项目引用并构建，再通过正常插件加载安装包。后台进程 PATH 必须包含 `agent-network`、`gh`；用户在服务外执行 `gh auth login --hostname github.com --web`，自行确认浏览器授权。插件不自动打开前台页面，不自动申请新凭据。

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

该片段依赖已有 `maintainer` profile，不能单独作为完整 agent 配置。维护 profile 的模型按本轮默认 `openai/gpt-6-luna`；使用 Sol 前核对真实 provider/model id。所需能力按工具授予：读 REST 为 network；评论需 network/message；创建 PR 需 network/write；本地 git 和文件修改使用既有执行环境与 bash/read/write/edit 的能力。运行工作区必须是独立任务工作树，不能指向安装 current。

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
