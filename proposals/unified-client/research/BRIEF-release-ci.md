# 设计任务书：发布仓库、CI 与多端分发

## 主人要求（10-27，转述）
打包、部署全部从 MacBook 移到 GitHub Actions，按完整版发布仓库的角度设计：Actions，一键安装与多种安装方式。Windows、Linux、macOS 都用 runner；桌面多端、iOS、安卓、Web 都要有完整的 CI 和配置。只用确认免费的额度，并用它替代本机跑的重型测试，避免开发机卡死。方案先设计好，之后可以慢慢调通。

## 必读输入
- `research/D0-actions-free-tier.md`：免费额度事实和四条约束（必须遵守）
- `research/D1-local-pipelines.md`：本机流程盘点、凭据清单、迁移难点
- `research/C4-install.md`：安装、卸载、迁移、自更新现状，目标命令（§6）
- `research/C1-clients.md` §3–§4：桌面壳与更新器参考
- `design.md` §3（命名、迁移）、§4.6（桌面壳）、§6（分发）、§11（阶段）

## 已定决策（不要推翻；发现硬伤就在文末「对已定决策的异议」里写明）
1. 发布源是公开主仓（将改名为 `GoYonderTogether/yonder`）。所有发布产物只在 Actions 里构建，由 tag 触发；本机不再打包、不再发版。版本规则保持 `0.<minor>.<YYMMDDNN>`。新增入库的 `scripts/version-check.mjs`，由「准备发版」workflow 自动改全部 manifest 和 CHANGELOG，并开 PR。
2. 产物：
   - 核心运行时（CLI 加内核）按平台出预构建包，内含官方 Node 运行时（校验 SHA256），覆盖 darwin-arm64/x64、linux-x64/arm64、win32-x64/arm64。用户机器上不再 clone 和编译。
   - npm 包（带 provenance）。
   - 桌面 Tauri 2：macOS dmg，Windows msi 和 nsis，Linux AppImage、deb、rpm；核心运行时作为 sidecar。
   - 手机端是 Tauri 2 iOS/Android 的界面客户端，只连远端完整节点。
   - `apps/app` 的 Web 静态产物：内置在核心运行时里由网关托管，同时供 yonder-cloud 部署和 PWA 使用。
   - 公开镜像 `ghcr.io/goyondertogether/yonder`（linux amd64/arm64，用于无界面的完整节点和设备节点）。
3. 安装方式：
   - `install.sh`（macOS/Linux）和 `install.ps1`（Windows）：下载、校验、装到用户目录、注册服务；检测到旧安装就调用 `yonder migrate`。
   - 包管理器：npm、Homebrew tap（公开 `GoYonderTogether/homebrew-tap`，formula 加 cask）、Scoop bucket、Docker；winget 后置。
   - 桌面安装包。
   - 卸载：`yonder uninstall` 加脚本参数，清单以 C4 §3.2 为准。
4. 更新：
   - 核心自更新改为下载预构建产物并校验，不再 git clone 后编译。
   - 桌面用 Tauri updater（`latest.json`，Ed25519）做三段式：后台下载，出现更新按钮，点击安装。
   - 两条链共用 `.update.lock`。
   - 正式版走 stable，`-beta.N` 走 beta。
5. 签名：
   - macOS Developer ID 加公证、iOS：需要 Apple 账号，到位前分别用 ad-hoc 和只做模拟器构建，并写明边界。
   - Windows：先申请 SignPath Foundation 免费开源签名，备选 Azure Trusted Signing。
   - Android：自建 keystore 放进 secret。
   - 全部产物附 SHA256SUMS，并用 `actions/attest-build-provenance` 生成来源证明。
6. 本机减负：
   - 重型测试全部搬到 Actions：Swift 构建与测试、service-host e2e、helper 安装、安装/卸载/迁移 e2e、全量矩阵。
   - 本机默认只跑与改动相关的快速单测；`npm run ci:remote` 用 `gh workflow run` 加 `gh run watch` 在当前分支触发远端重测。
   - 本机重型脚本改为显式开关才运行。
7. 真实模型测试：
   - 放在受保护的 environment `real-model` 里，只在 main 的 nightly 和 workflow_dispatch 时跑，用专用 API key secret。
   - 没有凭据时记为「未测：缺少凭据」并跳过；不复制 OAuth（CONTRIBUTING 的规定）。
8. 私有 yonder-cloud：
   - 只跑 ubuntu 小 job：server 测试用 postgres/redis 服务容器。
   - 前端产物从公开仓库 Release 下载，不重复构建。
   - 部署用 environment `production`（需要审批）。用专用部署用户和受限 SSH key（`command=` 强制命令执行 install.sh），不用 root。
   - 组织预算设为 $0，开启超额即停。
   - 说明 GitHub runner 到阿里云的连通性与防火墙要求。
9. 公开仓库安全：
   - actions 按 SHA 固定，最小 `permissions`。
   - 密钥只放在 environment（`release`、`production`、`real-model`）里，`pull_request` 不接触密钥，禁止会 checkout PR 代码的 `pull_request_target`。
   - tag 规则集只允许维护者推 `v*`；用 Dependabot 更新 actions。
10. 免费约束：只用标准 runner；macOS 并发不超过 5；artifact 保留 7 天；设置缓存与 concurrency 取消。

## 需要你核实（可联网，用 `~/.local/bin/agent-network run -- <命令>`，加超时）
- npm scope `@yonder` 是否已被占用（`npm view @yonder/cli`、`npm org` 相关公开信息）；被占就给替代方案。
- 主仓依赖里有没有原生模块（`find node_modules -name '*.node'`，以及 better-sqlite3、node:sqlite 的用法），这决定是否需要按平台各自构建。
- Tauri 2 的 iOS/Android 在 GitHub 托管 runner 上的构建前提（Xcode 版本、Android SDK/NDK），以及 sidecar 在移动端不可用这一点。
- SignPath Foundation 对开源项目的申请条件。

## 交付
最终回复就是文档全文（中文 Markdown，约 450–600 行），原样保存为 `proposals/unified-client/release-ci.md`。只读，不改仓库文件、不提交。结构：
1. 一页摘要：决策、产物矩阵、安装方式矩阵，以及需要主人准备的外部资源清单（含费用）。
2. 仓库与发布拓扑：公开主仓、tap、bucket、yonder-cloud、GHCR、Release 的关系图。
3. 产物矩阵：平台 × 产物 × runner 标签 × 签名状态 × 发布位置。
4. Workflow 清单：每个文件的名字、触发、job、runner、用时预估、密钥、产物；各平台 runner 怎么分配（macOS ≤5 的排法）。给出 2–3 个关键 workflow 的 YAML 骨架（ci、release、e2e-install）。
5. 发版流程：从准备发版 PR 到 tag，再到构建、签名、发布、更新 tap/bucket/镜像、通知自更新链路；回滚与撤回。
6. 安装、卸载、迁移、更新：脚本行为规格、安装目录、服务注册、校验、离线和代理场景、e2e 测试矩阵（每平台断言什么）。
7. 本机减负：哪些脚本迁走、本机留下什么、`ci:remote` 的形态、heavy lock 的去留。
8. 多端：桌面、iOS、安卓、Web/PWA 各自的构建链、签名、分发与 CI；什么要等 Apple 账号或签名证书。
9. yonder-cloud 部署链。
10. 安全模型与免费额度核算：每月预计分钟数，私有仓库要压在 2,000 分钟以内。
11. 落地阶段：S1–S6，每阶段写验收条件；第一阶段应当立刻让开发机减负。
12. 需修改的规格：spec 09 等，逐条列出。
13. 风险、未核实项、对已定决策的异议。
