# N03 独立安装与两个常驻 agent

**状态**：完成；独立安装、阶段更新、常驻服务、独立登录、Luna/Sol 工具与 MCP 中止均有真实证据。完整 T12 与恢复故障矩阵仍由 N05/N09/N14 验收。

**负责人**：Codex。

**依赖**：N02。

**功能依据**：10 §1–2；11 §2；既有 09 安装规范。完整条款见 [10](../../spec/10-local-maintenance.md)、[11](../../spec/11-official-plugins.md)，本任务不定义新功能。

## 允许路径

- packages/core/src/release/、packages/cli/src/index.ts 的必要安装接线
- README.md、README.zh-CN.md、对应 T14 记录
- 已批准安装目录 /Users/zoran/.yonder-harness
- 拟用运行 home /Users/zoran/.local/share/yonder-harness/home 与其 maintainer/operator 工作区
- macOS 本任务 launchd 配置；不修改其他应用服务

本任务文件、任务总表和必要 CHANGELOG 记录可更新；冻结功能文档仅 N00 的设计方可按批准修改。

## 实现安排

按 10 §2.1 从已审核本地标签实际安装，建立 maintainer/operator 与源码任务工作树绑定，保留默认 main 的用户交互入口；配置、独立登录、服务启动后经 MCP 使用安装版。完成一次由服务外部发起的阶段更新，后续由 Codex 复用此流程直到 N11 operator 接手。

使用本项目凭据验证 Luna 和用户指定 Sol 的实际 provider/model ID，Sol 结果写回 N09；缺模型或授权不冒充成功，也不阻塞可独立完成的 Luna 场景。

## 验证与交付

记录 executable realpath/version/commit/home/pid；独立于开发 cwd 启动，真实 Luna 调工具并返回，默认 main 可供用户交互；服务停止/启动后继续会话。对两个不同已审核本地版本验证切换后 MCP 调用来自目标安装版，同版本不更新如实记录；重启前没有仍在执行的维护任务。

记录实际命令、event/session/model、commit/PR 与失败/跳过；Yonder 和 Codex 的贡献分开归属。

## 问题

- 安装器原来未执行已冻结的来源记录与移除 .git，已在 updateRelease 的构建→改名处修复；version 增加 origin 资料。按既有规范补实现，没有新建安装系统。
- 0.1.1 实际安装成功，但 wrapper 经 current 软链接运行时 CLI 的 import.meta.url 与 argv 比较不相等，导致 version/help 静默退出。修复为比较实际入口路径；保留软链接启动回归检查，用新的 0.1.2 安装，不覆盖旧标签。
- 首次 operator 配置同时设置 level 与 capabilities，被 doctor 按契约拒绝；删除 level，仅保留 read/message 能力后 doctor ok:true/errors:[]。不是核心源码缺陷。
- 独立登录最初停在浏览器最终授权页；用户完成 Continue 后 login 返回 ok:true/provider:openai，此 home 独立保存 OAuth（auth.json 0600），未复制其他 home 的 OAuth。
- main 第一次文字摘要漏写 home 路径末尾 /home；原生 bash 输出正确。重启后同会话按工具 JSON 返回正确路径。记录为模型摘要错误，没有为此增加程序分支或校验层。
- 第一次中止请求被自动审核拒绝：审核认为尚未确认工具启动。补查时该 30 秒任务已经自然完成，未对空闲会话补 abort。第二次使用独立标记，先证实事件路由到 session=2、工具实际启动且无 run.end，再显式 abort 成功；没有绕过自动审核。

## 结果

- 本地标签 v0.1.1 指向 3ccb0cd；从服务外执行 update --repo /Users/zoran/Documents/yonder-harness --to 0.1.1，返回 updated:true。安装目录 /Users/zoran/.yonder-harness，current 指向 versions/0.1.1。未推送标签或创建 GitHub Release。
- 独立维护源码工作树已创建并附加：/Users/zoran/.codex/worktrees/yonder-maintainer/yonder-harness，起点 v0.1.1。尚未向模型下发任务。
- 0.1.2 本地标签对应 900b6779f1f1b987dee576abeb84427822e1dd13，安装版 version 已实际返回 source=/Users/zoran/.yonder-harness/versions/0.1.2 和完整 origin；正式版本副本无 .git。npm run build 通过；CLI/安装相关检查 2 文件、3 测试通过，保留软链接启动检查。
- 使用安装版 init 创建 /Users/zoran/.local/share/yonder-harness/home（0700）。保留 main CLI 入口，加入 maintainer（默认 Luna，另设独立 Sol 会话配置档）和 operator（read/message，更新工具待 N11）；维护工作树分支 zoran/yonder-maintainer 已切到 v0.1.2。MCP 实例 control 仅回环 19110，固定账号 acct:control:codex 关联 owner，随机凭据仅写入此 home。
- service install/status 成功，首次 pid=6919；stop/status 显示 loaded:false；start/status 显示 running/pid=7179。服务执行安装 bin/yonder，home 与源码独立；plist 未写凭据，未改其他应用服务。
- 标准 MCP Client 连接真实常驻安装版，发现 18 工具；stop→start 后重新连接 sessions_list 成功，当前尚无模型会话。客户端证据 /tmp/yonder-n03-tools.json、/tmp/yonder-n03-sessions-after-start.json。
- 由服务外的 0.1.2 安装版实际执行 update --repo /Users/zoran/Documents/yonder-harness --to 0.1.3 --home /Users/zoran/.local/share/yonder-harness/home：构建、新版 doctor、切换与服务重启成功，返回 updated:true。0.1.3 来源 commit=3a154973c958218fd4bccbf8775bf02d91b26119，服务 running/pid=8465，current 实际路径 /Users/zoran/.yonder-harness/versions/0.1.3。MCP 握手由 0.1.2 变为 0.1.3，发现 18 工具且 sessions_list 成功。再次更新同版本返回 updated:false；当前保留 0.1.1/0.1.2/0.1.3，home 未替换。证据 /tmp/yonder-n03-install-013.json、/tmp/yonder-n03-tools-013.json、/tmp/yonder-n03-sessions-013.json。
- 安装版 main：session=2，输入 01M57FYR92Z34VJPYXWWMYSPDW，run.end 模型 openai/gpt-6-luna/status:done。真实 bash 的 cwd=/Users/zoran/.local/share/yonder-harness/home/agents/main、yonder=/Users/zoran/.yonder-harness/bin/yonder、home=/Users/zoran/.local/share/yonder-harness/home；docs --list、node v24.21.0、npm 11.19.0、git 2.56.0 全部成功。以转录中的工具输出为证，不以模型摘要为证。
- maintainer：session=52，输入 01M57G0VAZGNT4QXYCNR6G29G4，Luna/status:done；实际读取独立工作树（158d29a）与安装来源（3a15497），正确区分。operator：session=19，输入 01M57G0FAKRBS9BBW17JG8FCS1，Luna/status:done，执行 read 并报告 read/message 与 N11 未接通边界；规则已去掉无关源码维护指令。
- Sol：session=35（独立 persistent 配置档），输入 01M57G0KZYRYDVJ4W80056S6K0，run.end 模型 openai/gpt-6.1-sol/status:done；转录证明实际 bash 输出 yonder-sol-installed-ready。不是 Codex 子 agent 或自报模型名。
- 四次运行全部结束后 service stop→start，pid=9482；MCP 重新连接后的输入 01M57G3XWVKNBJDW2E3T84CAM0 仍路由 session=2，并再次真实调用 yonder version 成功。输入 01M57G7E4AEWVK1MWW8CY6H2SP 的 bash 已实际启动后，通过 sessions_abort 明确中止；run.end=01M57G8VCGXESAWHTVVPCTNMPV，status:aborted/reason:aborted。两个临时启动标记已清理。
- 持久证据保存在真实 home 的原生事件/会话/转录；临时客户端副本 /tmp/yonder-n03-{main,maintainer,operator,sol,continue}-result.json、/tmp/yonder-n03-main-transcript.json、/tmp/yonder-n03-sol-transcript.json、/tmp/yonder-n03-run-ends-final.json。MCP 等待取消已在 N02 真实客户端检验；本阶段另验证安装版实际中止。
- 本任务由 Codex 完成安装接线、配置与验收；这些模型调用属于安装版 Yonder 的真实运行，尚不是它自主修复或提交 PR。默认 main 已可通过安装版 yonder chat --home /Users/zoran/.local/share/yonder-harness/home 使用，首次自主修复转 N04。

