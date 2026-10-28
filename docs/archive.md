# 归档索引

本文件记录已停止的仓库、分支与方向，以及它们在哪里可以找回。不在这里的旧内容以 `git log` 与 `CHANGELOG.md` 为准。

## 1. 归档 tag

标签均为 annotated tag，指向归档当日分支所在的提交。分支本身没有删除。

| tag | 提交 | 来源 | 为什么归档 |
|---|---|---|---|
| `archive/pre-rightapi-20261021` | `dfb9f5f` | 本地分支 `archive/main-before-rightapi-20261023` | rightapi 改造前的快照；其中 `proposals/ai-card/*` 已由 card 渠道取代 |
| `archive/private-main-20261020` | `f3d384a` | 旧私有镜像 `zoran-xc/yonder-harness` 的 `main`，与现 main 无共同祖先 | 旧私有历史；独有内容仅为 `patches/pi-durable-1.3.0.patch` 等，现已改用 vendored `packages/pi-durable` |
| `archive/card-plugin-20261027` | `28ae1bf` | 本地分支 `yonder/card-plugin`（从未推送到 origin） | 名片渠道、companion UI 与微信迁移的合集；功能已按 `plugins/channel-card` 等重新落地 |
| `archive/trim-overbuilt-20261022` | `d27e273` | `yonder/trim-overbuilt` | 撤回过度建设；被撤回的模块在 main 已不存在 |
| `archive/release-0.2.26102311` | `c02b9c1` | `release/0.2.26102311` | 历史发布分支，已被后续版本覆盖 |
| `archive/release-0.2.26102312` | `dcc325e` | `yonder/release-0.2.26102312` | 并入名片渠道的发布分支，已被 0.2.26102313 及以后覆盖 |

取回某个 tag：`git fetch origin tag archive/card-plugin-20261027 && git switch -c restore/card-plugin archive/card-plugin-20261027`。

## 2. 仓库与 bundle

下列仓库已停止开发。完整历史保存在本机 bundle：`~/.local/share/yonder-archive/repos-20261027/`。bundle 只在作者本机，不在仓库内；用 `git clone <bundle> <目录>` 还原。

| bundle | 来源仓库 | 说明 |
|---|---|---|
| `zoran-xc_AI-Being.bundle` | `zoran-xc/AI-Being` | 上一阶段总仓，含 `net/`、`web/`、`desktop/`、`ios/`、`plugins/` |
| `zoran-xc_being.bundle` | `zoran-xc/being` | Being：DeepSeek Harness 插件开发仓库 |
| `zoran-xc_being-net.bundle` | `zoran-xc/being-net` | Being 网络：账号、中继、Web 客户端 |
| `zoran-xc_being-releases.bundle` | `zoran-xc/being-releases` | Being macOS 安装包与更新元数据（仓库本身基本为空） |
| `zoran-xc_yonder-being.bundle` | `zoran-xc/yonder-being` | 本地常驻 AI 框架，Yonder 的前身 |
| `zoran-xc_yonder-harness.bundle` | `zoran-xc/yonder-harness` | 旧私有镜像，对应 `archive/private-main-20261020` |
| `GoYonderTogether_yondermesh.bundle` | `GoYonderTogether/yondermesh` | 跨设备 Agent 上下文总线 |

## 3. 已放弃的方向

- **being / yondermesh**：独立的"Being 网络"与"上下文总线"方向不再单独维护，仓库只保留 bundle。
- **hermes extensions**：本机的 hermes 扩展仓库已并入 `plugins/learning`。`plugins/hermes-experience` 保留为弃用的别名包，只转发到 `@yonder/plugin-learning`。

## 4. 命名

仓库内部名称已从 `yonder-harness` 改为 `yonder`（包、路径、数据目录）。GitHub 仓库名随后也改为 `yonder`（`yonder-web` 改为 `yonder-cloud`），旧 URL 由 GitHub 自动重定向。`yonder migrate` 负责把旧数据目录与 launchd 标签迁到新名字，因此迁移代码里仍会出现旧名。
