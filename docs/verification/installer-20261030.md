# 安装脚本跨平台验收

Windows 与 Linux 的一键安装脚本只在真实操作系统上跑得动，所以验收在 GitHub Actions 的临时机器上进行；
脚本随每个正式 Release 发布，因此验收也验证了发布链本身。

## 2026-10-30 第一轮（Linux 通过，Windows 未通过）

| 项 | 结果 | 证据 |
|---|---|---|
| Release 带出 `install.sh` / `install.ps1` | 通过 | `v0.3.26103018` 的附件含两者；`releases/latest/download/install.sh` 302 到该附件并返回 200 |
| Ubuntu 24.04 上 `curl … install.sh \| sh` | 通过 | 见下文「Linux 原始记录」 |
| Ubuntu 24.04 上安装后的日常链路 | 通过 | `doctor`、`start`、网关 303、`service install/status/restart`、`update --to latest`（verified）与回退到指定版本 |
| Windows 上 `install.ps1` | 通过 | `CI Windows` 的 `Windows one-line installer` 作业，见下文「Windows 原始记录」 |

### 修复前的两个阻断

1. `gh release create` 只列了 `dist-release/*.tgz dist-release/SHA256SUMS`，复制进 `dist-release/` 的脚本没有上传，
   `releases/latest/download/install.sh` 404。已把两个脚本加进附件列表（提交 `4414769`）。
2. 仓库里三个提示词模板文件名含 `:`（`codex:review.md` 等），Windows 无法检出仓库，
   整个 CI Windows 作业在 checkout 就失败。已改名为 `codex--review.md` 并用 frontmatter `command` 声明真实命令名
   （提交 `7db0045`），`/codex:review` 等用法不变。

### Linux 原始记录（lima Ubuntu 24.04.5 LTS aarch64，Node v22.23.4）

第一次运行失败：`npm ci` 报多个 tarball「seems to be corrupted」并 `ENOENT ... Cannot cd into node_modules/...`，
构建阶段清理临时目录后退出。判断为首次下载到一半的 npm 缓存，`npm cache clean --force` 后重跑通过；
脚本本身没有改动。该现象未在第二台干净机器上复现，记录为未定因。

第二次运行（`sh /tmp/install.sh`，日志 `/tmp/install2.log`）：

```
== 检查环境
Node.js 22.23.4
== 确定版本
目标版本 v0.3.26103018
== 准备 v0.3.26103018
已构建 v0.3.26103018（e6459eef812180a32e61196c8d18eae7f2f875a5）
== 写入安装入口
== 初始化数据目录
已初始化 /home/zoran.guest/.local/share/yonder/home
== 完成
```

结果核对：

- `install/current -> versions/0.3.26103018`，`install/bin/yonder` 存在；
- `yonder version` 报 `version: 0.3.26103018`、`install: …/install`、`home: …/home`，
  `origin` 是 `{repository, tag: v0.3.26103018, commit: e6459ee…, version}`；
- 生成的 home 有 `yonder.yaml`（`schema: 1`、`defaultModel: openai/gpt-6-luna`）、`agents/`、`presets/`；
- 全程约 6 分钟（含 `npm ci` 与完整 `npm run build`）。

未验证：登录模型供应商（这台机器没有模型凭据）、真实收发、`yonder` 无参数 TUI。

### 安装后的日常链路（同一台 Ubuntu VM）

| 命令 | 结果 |
|---|---|
| `yonder doctor` | 退出码 0；模型链 `openai/gpt-6-luna` 列出，`held: false` |
| `yonder start` | 启动成功，打印 `gateway: http://127.0.0.1:7690/` |
| `curl 127.0.0.1:7690` | 303（未登录跳转，符合网关行为） |
| `yonder channels list` | 列出随包但未启用的渠道（github 等），说明配置加载正常 |
| `yonder service install` | 写 `~/.config/systemd/user/dev.yonder.service`，`state: active`，有 pid |
| `yonder service status` / `restart` | 状态在 activating → active 之间正常推进，重启后新 pid，网关仍 303 |
| `yonder update --to latest` | 从 0.3.26103018 升到 0.3.26103019，`status: verified`（服务版本、commit、home、pid 全部核对通过） |
| `yonder update --to 0.3.26103018` | 回退到指定版本，同样 `verified: true`；`versions/` 保留两个版本，`current` 指回旧版 |
| `yonder update --check` | `spawn gh ENOENT`——该命令要求本机装 `gh`，这台 VM 没装；属工具缺失，不是安装链缺陷 |

### Windows 原始记录

`CI Windows` 运行 [41065916034](https://github.com/GoYonderTogether/yonder/actions/runs/41065916034)（windows-2025）：

- checkout、`npm ci`、`node scripts/check-pi-durable-workspace.mjs`、`npm run typecheck`、`npm run build` 全部通过
  ——说明 `install.ps1` 依赖的构建链在 Windows 上成立；
- `npm test` 失败：2285 个用例中 140 失败、2029 通过，涉及 50 个测试文件。

失败按原因归类（`windows-failures.json`）：

| 类别 | 数量 | 例子 |
|---|---:|---|
| 测试里硬编码 `/tmp/…` 作临时目录 | 65 | `mkdtemp '/tmp/yonder-ilink-diagnostics-test-XXXXXX'` |
| Windows 凭据文件权限判定 | 20 | `Unsafe credential storage path or permissions` |
| 其他断言差异 | 12 | 路径大小写/短名（`RUNNER~1` vs `runneradmin`） |
| 其他 | 27 | 20 秒超时、`spawnSync zsh ENOENT` 等 |
| SQLite 文件仍被占用（EBUSY） | 6 | `unlink …\state.db` |
| 其他 ENOENT | 8 | — |
| 需要绝对 `codexHome` | 1 | `Provide an absolute authorized codexHome` |
| 子进程 CLI | 1 | `Command failed: node /D:/a/...` |

这些是既有的 Windows 测试债（`scripts/e2e/ci-failures.md` 早有记录），不是本次安装脚本引入的。
本次修掉的是让作业连 checkout 都过不去的那一个（文件名含 `:`），另加了独立安装作业绕开这些债。

### Windows 上的真实验收（同一 workflow 的 `installer` 作业）

主 Windows 作业因为上面的测试债长期是红的，安装脚本在里面永远跑不到，所以新增独立作业
`Windows one-line installer`（`windows-2025`），只做三件事：`-DryRun` 解析版本、真实安装一次、再跑一次证明幂等。

运行 [41075769364](https://github.com/GoYonderTogether/yonder/actions/runs/41075769364) 的 `installer` 作业成功：

```
== 检查环境         Node.js 22.23.4
== 确定版本         目标版本 v0.3.26103020
== 准备 v0.3.26103020
已构建 v0.3.26103020（ca53c71122ad7be0e915e202341f9bb00a002780）
== 写入安装入口
== 初始化数据目录   已初始化 D:\a\_temp\yonder-home
== 完成
version: 0.3.26103020
install: D:\a\_temp\yonder-install
source: D:\a\_temp\yonder-install\versions\0.3.26103020
home: D:\a\_temp\yonder-home
origin: { version, commit: ca53c71…, repository, tag: v0.3.26103020 }
已安装 v0.3.26103020，跳过构建     ← 第二次运行
```

这一次运行暴露并修掉了三个 Windows 专属问题，都已提交：

1. **构建目录改名会让 npm 的 junction 失效**。`npm ci` 把 workspace 包装成绝对路径的 junction，在
   `<version>.tmp` 里构建完再 `Move-Item` 到 `versions/<version>`，`node_modules/@yonder/*` 全部指向旧路径，
   CLI 报 `Cannot find package '@yonder/core'`。改为直接在最终目录构建，用 `.yonder-install.json` 作为
   「已完成」标记（失败会清掉整个目录重来）。
2. **PowerShell 变量名不区分大小写**。`$Record`（路径）与 `$record`（JSON 正文）是同一个变量，
   `WriteAllText` 收到的是 JSON 当路径。改为 `$RecordPath` / `$recordJson`。
3. **步骤间的 `$env:` 不会保留**。CI 里两个步骤各自设置 `YONDER_INSTALL`/`YONDER_HOME`；`runner.temp`
   在 job 级 `env` 里不可用，所以只能在步骤内设置。

Windows 上未验证：`yonder service install`（计划任务）、`yonder start`、真实收发；
这台 runner 没有模型凭据，也没有登录交互终端。
