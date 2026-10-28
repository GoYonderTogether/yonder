# Yonder 发布仓库、CI 与多端分发设计

状态：设计稿，未修改任何仓库文件。事实性内容标注了出处。凭记忆写成、未联网核实的条目标为「未核实」。

## 1. 摘要

### 1.1 决策

1. 所有发布产物只在 `GoYonderTogether/yonder`（公开仓，原 `yonder`）的 Actions 里构建。触发条件是 maintainer 推送 `v*` tag，或「准备发版」workflow 在合并发版 PR 后自动打 tag。本机不再打包、不再发版。
2. 核心运行时（CLI 加内核）按 6 个平台各出一个预构建包，内含官方 Node 24 LTS。包在对应的原生 runner 上组装，不做交叉编译（原因见 §3.2）。
3. 桌面、手机、Web、npm、Docker、Homebrew、Scoop 的产物都从同一条 tag 流水线产出。`SHA256SUMS`、`release-manifest.json`、`latest.json` 由 `publish` job 统一生成并上传，避免矩阵 job 之间竞争写文件。
4. 免费额度只靠公开仓的标准 runner。私有 `yonder-cloud` 只跑 Linux 小 job，预计每月约 150–250 分钟，上限 2,000。
5. 本机只留与改动相关的快速单测。重型测试（Swift、service-host e2e、安装/卸载/迁移 e2e、全平台矩阵）全部由 `npm run ci:remote` 触发远端 workflow。
6. npm 包用 `bundleDependencies` 带上 fork 的 pi-ai 与 vendored pi-durable。`@yonder` scope 能否注册需要主人登录 npm 确认（§13.2）。取舍与决定见 §13.3、§13.4。

### 1.2 产物矩阵（概要，详见 §3）

| 产物 | 平台 | 状态 |
|---|---|---|
| 核心运行时包 `yonder-<v>-<os>-<arch>.{tar.gz,zip}` | darwin-arm64/x64、linux-x64/arm64、win32-x64/arm64 | S2 |
| npm 包（provenance） | 平台无关（JS 加 pi-tui 多平台预编译） | S4 |
| 桌面 dmg / msi+nsis / AppImage+deb+rpm | mac 2 个架构、win 2 个、linux 2 个 | S5 |
| Android APK/AAB、iOS | Android 签名；iOS 先只做模拟器 | S6 |
| `yonder-web-<v>.tar.gz` | 平台无关 | S2 |
| `ghcr.io/goyondertogether/yonder` | linux/amd64、arm64 | S2 |
| `SHA256SUMS`、`SHA256SUMS.minisig`、`release-manifest.json`、`latest.json`、attestation | 全部 | S2/S5 |

### 1.3 安装方式矩阵

| 方式 | macOS | Linux | Windows | 自更新由谁负责 |
|---|---|---|---|---|
| `install.sh` / `install.ps1` | ✓ | ✓ | ✓ | `yonder update` |
| 桌面安装包 | dmg | AppImage/deb/rpm | msi/nsis | Tauri updater 加 `install --from-app` |
| npm（`npm i -g @yonder/cli`） | ✓ | ✓ | ✓ | `npm update`，`yonder update` 只提示 |
| Homebrew（formula 加 cask） | ✓ | ✓（formula） | — | `brew upgrade` |
| Scoop | — | — | ✓ | `scoop update` |
| Docker | — | ✓ | — | 重新拉镜像 |
| winget | — | — | 后置 | — |

`.yonder-install.json` 增加 `installedBy: script|npm|brew|scoop|app|docker` 字段。`yonder update` 先读它，不是 `script` 时提示对应包管理器命令，不自行覆盖。这是 pi 的 `detectInstallMethod` 做法（`research/C1-clients.md` §3.3）。

### 1.4 需要主人准备的外部资源

| 资源 | 用途 | 费用 | 何时需要 |
|---|---|---|---|
| Apple Developer Program | Developer ID 签名、公证、iOS、TestFlight | 99 美元/年（Tauri iOS 签名页写明，`v2.tauri.app/distribute/sign/ios/`） | S4（macOS）、S6（iOS） |
| GitHub App `yonder-release-bot`（装在主仓、tap、bucket） | 开发版 PR 触发 CI、推 tap/bucket、推 tag | 免费 | S2 |
| npm 账号及可用 scope（`@yonder` 所有权未确认，见 §13.2） | 发布 npm 包 | 公开包免费（未核实） | S4 |
| SignPath Foundation 申请 | Windows 签名 | 免费，条件见 §8.4 | S4，须先有一个已发布的未签名版本 |
| Azure Trusted Signing（备选） | Windows 签名 | 约 10 美元/月（未核实）；个人和组织资格限制可能把中国大陆主体排除在外，未核实 | 仅 SignPath 被拒时 |
| Tauri updater 密钥对（Ed25519） | 桌面更新包签名 | 免费，自己生成 | S5 |
| minisign 密钥对 | 签 `SHA256SUMS` | 免费，自己生成 | S2 |
| Android upload keystore | APK/AAB 签名 | 免费，自己生成 | S6 |
| Google Play 开发者账号（可选） | 上架 Play | 一次性 25 美元（未核实） | 可选 |
| 模型 API key（专用） | `real-model` nightly | 按用量 | S3 |
| 阿里云部署用户和受限 SSH key | `yonder-cloud` 部署 | 现有 ECS | S3 |
| GitHub 组织预算设为 $0，开启「达到预算即停」 | 防止超额计费 | 0 | S1 |
| 仓库改名为 `GoYonderTogether/yonder`，新建 `homebrew-tap`、`scoop-bucket` | 分发 | 0 | S2 |

## 2. 仓库与发布拓扑

```
 maintainer ──PR──▶ GoYonderTogether/yonder (公开, Apache-2.0)
                      │  workflows: ci / ci-heavy / e2e-install / real-model
                      │             release-prepare / release-tag / release / docker
                      │
   tag v0.2.YYMMDDNN ─┤
                      ▼
              release.yml  (build → sign → e2e → publish)
        ┌─────────┬────────┴─────────┬───────────────┬────────────────┐
        ▼         ▼                  ▼               ▼                ▼
 GitHub Release   npm registry   GHCR 镜像    homebrew-tap      scoop-bucket
 (全部二进制,     (provenance)   ghcr.io/     (formula+cask)    (manifest)
  SHA256SUMS,                    goyonder
  latest.json,                   together/yonder
  release-manifest.json,
  attestation)
        │
        ├──▶ 用户: install.sh/ps1、桌面 updater、`yonder update`
        │
        └──▶ yonder-cloud (私有)  ◀── 只下载 yonder-web-<v>.tar.gz + 校验
                 ci: ubuntu 小 job + postgres/redis
                 deploy: environment production (审批) ──SSH 受限 key──▶ 阿里云 ECS
```

| 仓库 | 可见性 | 角色 | 谁写入 |
|---|---|---|---|
| `GoYonderTogether/yonder` | 公开 | 源码、全部 workflow、Release | maintainer；`release` 环境的 App token |
| `GoYonderTogether/homebrew-tap` | 公开 | `Formula/yonder.rb`、`Casks/yonder.rb` | 仅 `release.yml` 的 `publish` job，通过 App token |
| `GoYonderTogether/scoop-bucket` | 公开 | `bucket/yonder.json` | 同上 |
| `GoYonderTogether/yonder-cloud` | 私有 | `server/`、`deploy/` | maintainer |
| `ghcr.io/goyondertogether/yonder` | 公开 | 镜像 | `release.yml`，用 `GITHUB_TOKEN` 的 `packages: write` |

首次推送后，GHCR 包默认是私有的。需要在包设置里手动改成 public，并通过镜像 label `org.opencontainers.image.source` 关联到主仓。这一步在 S2 验收清单里。

## 3. 产物矩阵

### 3.1 矩阵

「签名」列为当前可达到的状态，Apple 账号到位后的状态写在括号里。

| 产物 | 平台 | runner | 签名 | 发布位置 |
|---|---|---|---|---|
| 运行时包 tar.gz | darwin-arm64 | `macos-15` | ad-hoc（Developer ID + 公证） | Release |
| 同上 | darwin-x64 | `macos-15-intel` | 同上 | Release |
| 同上 | linux-x64 | `ubuntu-24.04` | 无（SHA256SUMS + minisign + attestation） | Release |
| 同上 | linux-arm64 | `ubuntu-24.04-arm` | 同上 | Release |
| 运行时包 zip | win32-x64 | `windows-2025` | 无（SignPath 通过后签 `node.exe` 外的自有 exe/dll） | Release |
| 同上 | win32-arm64 | `windows-11-arm` | 同上 | Release |
| `yonder-web-<v>.tar.gz` | 平台无关 | `ubuntu-24.04` | attestation | Release；内置在每个运行时包的 `app/web/` |
| npm 包 | 平台无关 | `ubuntu-24.04` | provenance | npm |
| Docker 镜像 | linux/amd64、arm64 | `ubuntu-24.04` + `ubuntu-24.04-arm`（原生各构一个，再合并 manifest） | attestation | GHCR |
| 桌面 dmg + `.app.tar.gz(.sig)` | mac arm64、x64 | `macos-15`、`macos-15-intel` | ad-hoc → Developer ID + 公证；updater 用 Ed25519 | Release |
| 桌面 msi、nsis `.exe`、`.nsis.zip(.sig)` | win x64、arm64 | `windows-2025`、`windows-11-arm` | 先未签名，SignPath 通过后签名 | Release |
| 桌面 AppImage、deb、rpm | linux x64、arm64 | `ubuntu-24.04`、`ubuntu-24.04-arm` | SHA256SUMS + minisign | Release |
| Android APK/AAB | arm64-v8a、armeabi-v7a、x86_64 | `ubuntu-24.04` | 自建 keystore | Release（APK）；AAB 仅在上 Play 时用 |
| iOS | 模拟器 `.app` zip | `macos-26` | 无 | 只作 7 天 artifact，不进 Release；真机 ipa 等 Apple 账号 |
| `latest.json`、`release-manifest.json`、`SHA256SUMS(.minisig)`、`install.sh`、`install.ps1` | — | `publish` job（ubuntu） | minisign、attestation | Release |

### 3.2 运行时包为什么要按平台分别组装

已核实的事实（只读检查主仓）：

- 数据库用 `node:sqlite`（`packages/core/src/runtime/db.ts:1`、`packages/pi-durable/src/storage/sqlite/node.ts:3-4`）。仓库里没有 `better-sqlite3`。Node 官方二进制自带 `node:sqlite`，不需要编译原生模块。
- 运行时依赖里的 `.node` 文件有两类：
  - `@earendil-works/pi-tui` 在 `native/{darwin,linux,win32}/prebuilds/<arch>/` 下自带全平台预编译（实测 `node_modules/@earendil-works/pi-tui/native/…` 有 darwin-x64/arm64、linux-x64/arm64、win32-x64/arm64 六份）。运行时只加载本平台那份，打包时按目标平台裁剪其余五份。
  - `@resvg/resvg-js@2.6.2`（`plugins/tasks/package.json:20`）是 napi 包，平台二进制通过 optional dependency 分发。`npm ci` 只装本机平台那份。
- `rolldown`、`lightningcss`、`fsevents` 来自 `vitest`/`vite`，是 devDependency，不进运行时包。

结论：`resvg` 决定了每个平台包都要在对应架构上执行 `npm ci --omit=dev`，或者在 `npm ci` 时显式设 `npm_config_os`、`npm_config_cpu` 做交叉安装。GitHub 免费提供全部 6 种原生 runner，所以选原生。好处是 `node --test` 冒烟能直接在目标平台上跑，不需要模拟器。

没有 SEA（`design.md` §4.6 已否决）。包布局：

```
yonder-<v>-<os>-<arch>/
  node/            # 官方 Node 24.x，下载后核对 nodejs.org 发布的 SHASUMS256.txt
  app/             # packages/*/dist、plugins/*/dist、web 静态产物、omit=dev 的 node_modules
  bin/yonder, bin/yonder-service (.cmd on win)
  macos/           # 仅 darwin：YonderStatus.app、Yonder Helper.app（阶段 6 删除状态栏 App）
  .yonder-install.json   # {version, commit, platform, installedBy, sha256}
```

仅支持 glibc。Alpine（musl）不出包，`install.sh` 检测到 musl 直接报错，文档写明。

### 3.3 版本号与各平台格式

版本规则 `0.<minor>.<YYMMDDNN>`，例如 `0.2.26102705`。

- 合法 SemVer：数字段无前导零。beta 写成 `0.2.26102705-beta.1`。
- Tauri updater 要求 `version` 是合法 SemVer（`research/C4-install.md` §4.2），符合。
- Android `versionCode`：Tauri 默认用 `major*1000000 + minor*1000 + patch` 推算（`v2.tauri.app/distribute/google-play/`）。`0.2.26102705` 得到 26,104,705，在 Google Play 上限（2,100,000,000）内，递增也成立。仍建议在 `tauri.android.conf.json` 里显式写 `bundle.android.versionCode`，由 `version-check.mjs` 同步。
- MSI 风险：Windows Installer 的 ProductVersion 第三段上限是 65535（凭记忆，未核实）。`26102705` 超限，`tauri build` 的 MSI 步骤可能失败。建议 `bundle.windows.wix.version` 单独写 `0.2.<自 2026-01-01 起的天数>.<NN>`，由 `version-check.mjs` 生成。NSIS 不受影响，updater 走 NSIS。S5 的第一个任务是在 `windows-2025` 上实测，见 §13.2。

## 4. Workflow 清单

### 4.1 总表

| 文件 | 触发 | 主要 job（runner、预估用时） | 密钥/环境 | 产物 |
|---|---|---|---|---|
| `ci.yml` | `pull_request`、push main | `static`（ubuntu-24.04，3 min：lint、`tsc -b`、版本检查、actionlint+zizmor）；`test-linux`（ubuntu-24.04，8 min：build:core + vitest）；`test-win`（windows-2025，12 min：vitest 子集）；`swift`（macos-15，10 min：仅 `packages/macos*` 变更时，build + `swift test`） | 无 | 无 |
| `ci-heavy.yml` | `workflow_dispatch`、nightly cron | `service-host`（macos-15，20 min，串行 9 个脚本）；`helper-install`（macos-15，5 min）；`full-matrix`（6 个原生 runner 跑完整 vitest，各 10–15 min） | 无 | 7 天 artifact（失败日志） |
| `e2e-install.yml` | `workflow_call`（release 内调用）、`workflow_dispatch`、push main 且改动 `scripts/install.*`/`release/` | 5 个 job，见 §6.6 | 无 | 7 天 artifact |
| `real-model.yml` | nightly（仅 main）、`workflow_dispatch` | `real`（ubuntu-24.04，10 min） | environment `real-model`：`YONDER_TEST_API_KEY` | 无 |
| `release-prepare.yml` | `workflow_dispatch`（输入：`kind=stable\|beta`、`bump_minor`） | `prepare`（ubuntu-24.04，2 min）：跑 `version-check.mjs --bump`，开 PR | environment `release`：App 私钥 | 发版 PR |
| `release-tag.yml` | push main，且 commit 信息匹配 `chore(release): ` | `tag`（ubuntu-24.04，1 min）：校验 `version-check.mjs --check`，用 App token 打 tag | environment `release` | tag |
| `release.yml` | push tag `v*` | 见 §4.3 | environment `release` | Release 全部资产 |
| `docker.yml` | `workflow_call`（release 内调用）、PR 改动 `Dockerfile` 时只构建不推送 | `build-amd64`（ubuntu-24.04）、`build-arm64`（ubuntu-24.04-arm）、`merge`，各 5–8 min | `GITHUB_TOKEN` `packages: write` | 镜像 |
| `.github/dependabot.yml` | 每周 | `github-actions`、`npm`（`groups` 合并同类）、`cargo`、`docker` | — | PR |

私有仓 `yonder-cloud` 的两个 workflow 见 §9。

### 4.2 macOS 并发排法（上限 5）

GitHub 免费计划的 20 并发 job 里，macOS 最多 5 个，超出会排队，不会失败（`research/D0-actions-free-tier.md`）。所以排法是预算分配：

| 来源 | 峰值同时占用的 macOS job | 做法 |
|---|---|---|
| `release.yml` | 3 | 运行时包 2 个（`macos-15`、`macos-15-intel`）先跑完；之后桌面 mac 2 个和 iOS 1 个同时跑，最多 3 个 |
| `ci.yml`（PR） | 1 | `swift` job，用 `concurrency: {group: mac-pr, cancel-in-progress: true}` |
| `ci-heavy.yml` / `e2e-install.yml` | 1 | `concurrency: {group: mac-heavy, cancel-in-progress: false}`，保证全仓同时只有一个 |

合计最多 3 + 1 + 1 = 5。其他平台用 `strategy.max-parallel` 控制，不需要刻意限制。

### 4.3 `release.yml` job 图

```
verify ─▶ build-dist ─▶ runtime(6) ─┬─▶ e2e-install(5) ─┐
                                    ├─▶ docker          ├─▶ publish ─▶ post-publish
                        build-web ──┤                   │   (draft→published)  (npm,tap,bucket,channel)
                                    ├─▶ desktop(6) ─────┤
                                    └─▶ android / ios ──┘
```

| job | runner | 用时 | 说明 |
|---|---|---|---|
| `verify` | ubuntu-24.04 | 1 min | `version-check.mjs --check`；tag 名等于 `v<VERSION>`；tag 的提交在 main 的祖先链上；tag 为 `-beta.N` 时 `channel=beta` |
| `build-dist` | ubuntu-24.04 | 6 min | `npm ci`、`tsc -b`、`apps/app` 构建；上传 `dist` 和 `web` artifact |
| `runtime`（6 路矩阵） | 见 §3.1 | 6–10 min | 下载 `dist`，`npm ci --omit=dev`，裁剪 pi-tui 预编译，下载并校验 Node，签名，打包，冒烟 `yonder version --json` 和 `doctor` |
| `e2e-install`（调用 `e2e-install.yml`） | 见 §6.6 | 8–15 min | 对 draft 里的包，用 `--base-url file://` 做真实安装 |
| `docker` | ubuntu 两个架构 | 8 min | 基于 `runtime` 产出的 linux 包，不重新编译 |
| `desktop`（6 路矩阵） | 见 §3.1 | 15–25 min（Rust 冷编译，缓存命中后 8–12 min） | Tauri 构建；`createUpdaterArtifacts: true` |
| `android` | ubuntu-24.04 | 15 min | 见 §8.2 |
| `ios` | macos-26 | 15 min | 模拟器构建，见 §8.3 |
| `publish` | ubuntu-24.04 | 3 min | 汇总 artifact；生成 `SHA256SUMS`、minisign 签名、`release-manifest.json`、`latest.json`（`scripts/make-latest-json.mjs`，缺任何一个平台条目就失败）；`attest-build-provenance`；创建 draft Release 并上传；全部 e2e 绿后转为 published |
| `post-publish` | ubuntu-24.04 | 5 min | npm 发布；更新 tap、bucket；更新 `channel-beta` 滚动 Release；全部失败可单独重跑 |

`workflow_run` 与 `GITHUB_TOKEN` 触发的事件不会再触发别的 workflow，所以所有串联都写在同一个 workflow 里，用 `needs`。

### 4.4 骨架一：`ci.yml`

```yaml
name: CI
on:
  pull_request:
  push: { branches: [main] }
permissions: {}
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
jobs:
  static:
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    permissions: { contents: read }
    steps:
      - uses: actions/checkout@<sha>   # v4
        with: { persist-credentials: false }
      - uses: actions/setup-node@<sha> # v4
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - run: node scripts/version-check.mjs --check
      - run: npm run lint
      - run: npm run typecheck
      - run: npx actionlint && npx zizmor .github/workflows   # 具体安装方式 S1 定
  test-linux:
    needs: static
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    permissions: { contents: read }
    steps:
      - uses: actions/checkout@<sha>
        with: { persist-credentials: false }
      - uses: actions/setup-node@<sha>
        with: { node-version: 24, cache: npm }
      - run: sudo apt-get install -y ripgrep
      - run: npm ci
      - run: npm run build:core            # 新增脚本：不含 Swift 段
      - run: npm test -- --maxWorkers=4
      - run: npm run test:node
  test-win:
    needs: static
    runs-on: windows-2025
    timeout-minutes: 25
    permissions: { contents: read }
    steps:
      - uses: actions/checkout@<sha>
        with: { persist-credentials: false }
      - uses: actions/setup-node@<sha>
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - run: npm run build:core
      - run: npm test -- --maxWorkers=2
  swift:
    if: ${{ needs.static.outputs.swift_changed == 'true' }}
    needs: static
    runs-on: macos-15
    timeout-minutes: 30
    concurrency: { group: mac-pr, cancel-in-progress: true }
    permissions: { contents: read }
    steps:
      - uses: actions/checkout@<sha>
        with: { persist-credentials: false }
      - uses: actions/setup-node@<sha>
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - run: npm run build
      - run: swift test --package-path packages/macos-helper -j 4
      - run: node scripts/yonder-permissions.mjs self-check
```

说明：

- `npm run build:core` 是新增脚本，只跑 `check-pi-ai-bundle`、`tsc -b`、`plugins/devices/build.mjs`、`interaction/build.mjs`，不含 `build-macos.mjs`。现有 `npm run build`（`package.json:41`）把 `build-macos.mjs` 直接串在里面，非 darwin 上是否能跳过未核实，所以要拆。
- 现有 `ci.yml` 的 `macos` job 保留一段过渡期，等 `swift` job 稳定后删除。
- `swift_changed` 由 `static` job 用 `git diff --name-only origin/${{ github.base_ref }}...HEAD` 判断，不引入第三方 paths-filter。

### 4.5 骨架二：`release.yml`（节选）

```yaml
name: Release
on:
  push: { tags: ['v*'] }
permissions: {}
concurrency: { group: release-${{ github.ref_name }}, cancel-in-progress: false }
jobs:
  verify:
    runs-on: ubuntu-24.04
    permissions: { contents: read }
    outputs:
      version: ${{ steps.v.outputs.version }}
      channel: ${{ steps.v.outputs.channel }}
    steps:
      - uses: actions/checkout@<sha>
        with: { fetch-depth: 0, persist-credentials: false }
      - id: v
        run: node scripts/version-check.mjs --check --tag "$GITHUB_REF_NAME" --github-output "$GITHUB_OUTPUT"
      - run: git merge-base --is-ancestor "$GITHUB_SHA" origin/main

  runtime:
    needs: [verify, build-dist]
    strategy:
      fail-fast: false
      matrix:
        include:
          - { os: darwin, arch: arm64, runner: macos-15 }
          - { os: darwin, arch: x64,   runner: macos-15-intel }
          - { os: linux,  arch: x64,   runner: ubuntu-24.04 }
          - { os: linux,  arch: arm64, runner: ubuntu-24.04-arm }
          - { os: win32,  arch: x64,   runner: windows-2025 }
          - { os: win32,  arch: arm64, runner: windows-11-arm }
    runs-on: ${{ matrix.runner }}
    timeout-minutes: 30
    environment: release                     # 仅 darwin 需要签名材料；其余平台不读密钥
    permissions: { contents: read, id-token: write, attestations: write }
    steps:
      - uses: actions/checkout@<sha>
        with: { persist-credentials: false }
      - uses: actions/setup-node@<sha>
        with: { node-version: 24 }
      - uses: actions/download-artifact@<sha>
        with: { name: dist }
      - run: node scripts/pack-runtime.mjs --os ${{ matrix.os }} --arch ${{ matrix.arch }} --out out
        env:
          APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}   # 空值则 ad-hoc
          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
      - run: node out/yonder-*/bin/yonder version --json   # 冒烟，Windows 用 .cmd
      - uses: actions/upload-artifact@<sha>
        with: { name: runtime-${{ matrix.os }}-${{ matrix.arch }}, path: out/*.{tar.gz,zip}, retention-days: 7 }

  publish:
    needs: [runtime, desktop, android, ios, docker, e2e-install]
    runs-on: ubuntu-24.04
    environment: release
    permissions: { contents: write, id-token: write, attestations: write }
    steps:
      - uses: actions/download-artifact@<sha>
        with: { path: assets, merge-multiple: true }
      - run: node scripts/make-release-assets.mjs assets    # SHA256SUMS、manifest、latest.json
      - run: minisign -S -s <(printf '%s' "$MINISIGN_KEY") -m assets/SHA256SUMS
        env: { MINISIGN_KEY: '${{ secrets.MINISIGN_KEY }}' }
      - uses: actions/attest-build-provenance@<sha>
        with: { subject-path: 'assets/*' }
      - run: gh release create "$GITHUB_REF_NAME" assets/* --draft --notes-file notes.md ${{ needs.verify.outputs.channel == 'beta' && '--prerelease' || '' }}
        env: { GH_TOKEN: '${{ github.token }}' }
```

Windows 运行 job 里的 `run` 默认是 `pwsh`，上面几条要加 `shell: bash`。S2 实现时统一处理。`environment: release` 放在 6 路矩阵里，每个 job 都会读一次环境，没有 required reviewers，所以不会弹审批。Windows 和 Linux 的 job 不引用 `secrets.APPLE_*`，也就不会读到。

### 4.6 骨架三：`e2e-install.yml`

```yaml
name: e2e-install
on:
  workflow_call:
    inputs: { version: { type: string, required: true }, artifact_prefix: { type: string, default: runtime- } }
  workflow_dispatch:
    inputs: { ref: { type: string, default: '' } }
permissions: {}
jobs:
  linux:
    strategy:
      fail-fast: false
      matrix: { runner: [ubuntu-24.04, ubuntu-24.04-arm] }
    runs-on: ${{ matrix.runner }}
    timeout-minutes: 25
    permissions: { contents: read }
    steps:
      - uses: actions/checkout@<sha>
        with: { persist-credentials: false }
      - uses: actions/download-artifact@<sha>
        with: { pattern: 'runtime-*', path: pkg, merge-multiple: true }
      - run: bash scripts/e2e/install-linux.sh pkg
  windows:
    strategy:
      fail-fast: false
      matrix: { runner: [windows-2025, windows-11-arm] }
    runs-on: ${{ matrix.runner }}
    timeout-minutes: 30
    permissions: { contents: read }
    steps:
      - uses: actions/checkout@<sha>
        with: { persist-credentials: false }
      - uses: actions/download-artifact@<sha>
        with: { pattern: 'runtime-*', path: pkg, merge-multiple: true }
      - run: pwsh scripts/e2e/install-windows.ps1 -Pkg pkg
  macos:
    runs-on: macos-15
    timeout-minutes: 30
    concurrency: { group: mac-heavy, cancel-in-progress: false }
    permissions: { contents: read }
    steps:
      - uses: actions/checkout@<sha>
        with: { persist-credentials: false }
      - uses: actions/download-artifact@<sha>
        with: { pattern: 'runtime-darwin-arm64', path: pkg, merge-multiple: true }
      - run: bash scripts/e2e/install-macos.sh pkg
```

macOS 分两个 job 时（arm64、x64）并发数仍受 `mac-heavy` 组限制。在 release 里调用时，x64 那一份可以用 `macos-15-intel` 另起一个 job，同样放进 `mac-heavy` 组串行。

## 5. 发版流程

### 5.1 步骤

1. **准备**。maintainer 在 Actions 页点 `release-prepare`，选 `stable` 或 `beta`。workflow 跑 `scripts/version-check.mjs --bump`：
   - 算出下一个版本。`<minor>` 沿用，`bump_minor` 为真时加一；`YYMMDD` 取 UTC 日期；`NN` 取当天已存在的 tag 里最大序号加一。
   - 同步改所有 `package.json`、`package-lock.json`、`Cargo.toml`、`tauri.conf.json`、`tauri.android.conf.json` 的版本，并把 `CHANGELOG.md` 的 `## [Unreleased]` 归入新版本节。`packages/pi-durable` 保持上游 `1.3.0`（`research/D1-local-pipelines.md` §六）。
   - 用 GitHub App token 开 PR，标题 `chore(release): <版本>`。不能用 `GITHUB_TOKEN`，因为它开的 PR 不会触发 `pull_request` 的 CI，必需检查永远不会出现。
2. **审阅合并**。CI 全绿、maintainer 审阅后 squash 合并，提交信息保持 `chore(release): <版本>`。
3. **打 tag**。`release-tag.yml` 在 main 上看到该提交，再跑一次 `version-check.mjs --check`，用 App token 创建并推送 `v<版本>`。tag ruleset 把 App 加入 bypass，同时仍只允许维护者手动推 `v*`（见 §10）。App 推送的 tag 会触发 `release.yml`。
4. **构建、签名、测试**。`release.yml` 按 §4.3 执行。任何 job 失败，release 停在 draft 之前，不会有公开产物。
5. **发布**。`publish` 创建 draft Release，上传资产；`e2e-install` 已在前面对未发布包做过真实安装；全部通过后 `gh release edit --draft=false`。`beta` 版标 prerelease。
6. **下游**。`post-publish`：
   - `npm publish --provenance`（见 §13.2 的打包问题）；
   - 向 `homebrew-tap`、`scoop-bucket` 各推一个提交，更新版本和 SHA256；
   - 更新滚动 Release `channel-beta`（stable 和 beta 都更新），上传最新的 `release-manifest.json` 和 `latest.json`；
   - 推送 `docker.yml` 已构建好的镜像标签：`:<v>`，stable 另打 `:latest`，beta 打 `:beta`。
7. **通知自更新链路**。不需要主动通知：
   - 内核：`yonder update` 读 `release-manifest.json`。stable 地址是 `…/releases/latest/download/release-manifest.json`，不走 GitHub API，避免匿名每小时 60 次限速；beta 读 `…/releases/download/channel-beta/release-manifest.json`。
   - 桌面：Tauri updater 的 endpoint 用 `…/releases/latest/download/latest.json`（stable），beta 用 `channel-beta` 下的 `latest.json`。Tauri 2 支持运行时覆盖 endpoint，由客户端设置里的「通道」决定。
   - `plugins/channel-github` 现有的 Release 事件监听继续用，但 `update-job` 要改成调用预构建更新（`plugins/channel-github/src/update-job.ts:107` 的 `bin/yonder` 缺 `.cmd`，`updates.ts:79` 限制 darwin，见 §12）。

### 5.2 回滚与撤回

| 场景 | 做法 | 影响范围 |
|---|---|---|
| Release 发布后发现严重问题 | 先把该 Release 转回 draft。`releases/latest/download/…` 会立刻指回上一个 stable，新用户和 updater 不再看到它。再发一个更高版本修复 | 已更新的用户不会自动降级 |
| 需要用户回退 | `yonder update --to <旧 tag>`（`versions/` 保留最近 3 个，`research/C4-install.md` §1.2）；`state.db` schema 不可降级的版本要在发布说明里标注（`design.md` §11 阶段 7） | 用户手动 |
| npm | 优先 `npm deprecate` 并发修复版；24 小时内可 `unpublish` 的规则以 npm 当前政策为准（未核实） | — |
| GHCR | 把 `:latest` 重新指向上一个镜像摘要（`imagetools create`） | — |
| tap / bucket | `git revert` 对应提交 | — |
| `channel-beta` | 用上一个 tag 的资产覆盖重传 | beta 用户 |
| tag 打错 | 未发布时删除 tag 和 draft，修复后用新序号重打。不复用已推送的版本号 | — |

## 6. 安装、卸载、迁移、更新

### 6.1 安装目录与服务注册

目录与 `design.md` §3 对齐（10-27 决定），不沿用旧的 `~/.yonder-harness`；服务名沿用 `research/C4-install.md` §6.1：

| | macOS | Linux | Windows |
|---|---|---|---|
| 运行时 | `~/.local/share/yonder/runtime/<version>/`，`current` 软链指向当前版本 | 同左 | `%LOCALAPPDATA%\Yonder\runtime` |
| 数据 | `~/.local/share/yonder/home`（旧安装在 `~/.local/share/yonder-harness/home`，由 `yonder migrate` 迁入，`design.md` §3.2） | 同左 | `%LOCALAPPDATA%\Yonder\home` |
| 命令入口 | `~/.local/bin/yonder` | 同左 | `yonder.cmd`，目录加入用户 PATH |
| 服务 | `~/Library/LaunchAgents/dev.yonder.harness{,.status}.plist` | `~/.config/systemd/user/dev.yonder.harness.service` | 任务计划 `Yonder Harness` 加 `yonder-service.cmd` |


### 6.2 `install.sh` 行为规格（POSIX sh）

参数：`--version <v>`、`--channel stable|beta`、`--prefix <dir>`（等同 `YONDER_INSTALL`）、`--service` / `--no-service`、`--no-modify-path`、`--base-url <url>`（镜像或测试）、`--from <tar.gz> --sums <SHA256SUMS>`（离线）、`--yes`、`--uninstall`。

流程：

1. 检测 OS 和架构。`uname -m` 在 macOS 上可能被 Rosetta 终端伪装为 x86_64，用 `sysctl -n hw.optional.arm64` 纠正。Linux 检测 musl，是就报错退出。
2. 解析版本：未指定则读 `release-manifest.json`，得到本平台包的 URL 和 SHA256。
3. 下载到临时目录，用 `curl -fL --retry 3`。`curl` 原生读取 `HTTPS_PROXY`、`ALL_PROXY`、`NO_PROXY`，脚本不另做代理逻辑。
4. 校验：包的 SHA256 与 `SHA256SUMS` 一致。若本机有 `minisign`，同时校验 `SHA256SUMS.minisig`，公钥内嵌在脚本里。没有 `minisign` 时只做 SHA256，并提示。安装完成后 `yonder` 自己再用 `node:crypto` 校验一次 minisig（包内带公钥）。
5. 解压到 `<install>/versions/<v>.tmp`，校验 `.yonder-install.json`，改名为 `<v>`，再按现有「先建新链接再 rename 覆盖」切换 `current`（`packages/core/src/release/index.ts:700-760` 的做法）。持 `.update.lock`。
6. 写 `bin/yonder`。提示 PATH，默认不改 shell 配置；交互且用户同意时才追加一行到 `~/.zshrc`/`~/.bashrc`。
7. 检测旧安装：存在 `~/.local/share/yonder-harness/home`、或 launchd 里有 `dev.yonder.harness`、或旧的 `.yonder-install.json` 的 `source` 为 git 构建。命中则先 `yonder migrate --dry-run` 打印计划，用户确认（`--yes` 跳过）后执行 `yonder migrate`，再注册服务。
8. 询问是否注册服务（`--service` 直接注册），执行 `yonder service install`。
9. 任何一步失败，不动已有 `current`，清理临时目录，退出码 1。同版本再次运行直接返回，退出码 0。

`--uninstall`：优先调用已安装的 `yonder uninstall`；找不到时按 §6.4 的清单兜底删除。

### 6.3 `install.ps1`

通过 `irm <url> | iex` 运行时 `iex` 不支持顶层 `param()`。所以脚本末尾判断是否被 dot-source，并提供 `& ([scriptblock]::Create((irm <url>))) -Version x -Service` 的带参用法。

行为与 `install.sh` 一致，差异：

- 架构用 `$env:PROCESSOR_ARCHITECTURE`（x64 → `win32-x64`，ARM64 → `win32-arm64`），同时用 `[System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture` 防 x64 PowerShell 跑在 ARM 上。
- 下载用 `Invoke-WebRequest`，校验用 `Get-FileHash -Algorithm SHA256`，解压用 `Expand-Archive`。不需要管理员权限。
- `current` 用目录 junction（`index.ts:714-760`）。
- PATH 写用户级环境变量 `[Environment]::SetEnvironmentVariable('Path', …, 'User')`，新终端生效。
- 检查 `bash.exe`（`where bash.exe`、`%ProgramFiles%\Git\bin\bash.exe`）。缺失时警告，因为 shell 工具依赖 Git Bash（`research/C4-install.md` §2）。询问后才执行 `winget install --id Git.Git`，不静默安装。
- 任务计划的 `/TR` 命令超过 262 字符会失败（`index.ts:375-478`）。默认安装路径 `%LOCALAPPDATA%\Yonder` 短于该限制；自定义前缀过长时，脚本在写任务前先计算长度并报错。

### 6.4 卸载

`yonder uninstall [--purge] [--keep-home] [--json]`，行为取 `research/C4-install.md` §6.1，清单取 §3.2：

- 默认：停服务；删 LaunchAgent plist、systemd 单元、任务计划及 `service.json`；删 `<install>`。不删 home。
- `--purge`：追加删 `~/.local/share/yonder/home`（含约 1.18 GB 的 `state.db` 和 8,892 项 `background/`，需要进度输出和可中断）、`helper/`、`/Library/PrivilegedHelperTools/dev.yonder.power` 与 `/Library/LaunchDaemons/dev.yonder.power.plist`（一次管理员授权）、运行时 socket 和锁。PATH 里的手工 export 只打印提示，不改用户文件。
- 先打印将删除的路径，区分「数据/凭据」与「代码」。不存在也算成功。
- 通过 brew/npm/scoop/docker 安装的，`yonder uninstall` 只清理服务和数据，不删包本身，并提示对应的卸载命令。

### 6.5 迁移

`yonder migrate [--dry-run] [--json]` 的覆盖点以 `research/C4-install.md` §3.3 的 10 条为准，并带 `design.md` §3.4 的 4 条。发版相关的新增要求：

- 迁移前持 `.update.lock`，拒绝与 `yonder update` 并发。
- 迁移后重新生成 wrapper、plist、systemd 单元、`service.json`，其中的绝对路径（node 路径、home 路径）必须以新的 `current` 为准。
- 命名管道名由 home 路径哈希决定（`packages/core/src/control/index.ts:17-31`），搬家后必须重注册服务。
- 迁移前备份为 `*.pre-migrate-<日期>`，失败时保留回滚点。

### 6.6 更新与两条链共用锁

| 链 | 触发 | 动作 |
|---|---|---|
| 内核 `yonder update` | 用户手动，或 `channel-github` 的一次性作业 | 读 `release-manifest.json` → 下载本平台包 → 校验 → 解到 `versions/<v>` → 持 `.update.lock` 切 `current` → `doctor` 通过后重启服务；失败回滚 |
| 桌面 Tauri updater | 后台 `check()` → `download()` → 出现更新按钮 → 点击 `install()` + `relaunch()` | 只替换 App 本身，不触碰 `current` |
| 桌面启动后对齐 | App 新版启动时发现随包运行时版本大于 `current` | 壳调用随包的 `yonder install --from-app <resources/runtime> --service`，持 `.update.lock`，把运行时复制进 `versions/<v>` 后切 `current` |

这样两条链只在「切 `current`」这一步相遇，都持同一把 `.update.lock`（`index.ts:794-826`），不会出现两个进程同时改 `current`。`docs/status.md:196` 仍写着「尚未补跨入口安装锁」，与代码里的 `.update.lock` 不一致，疑似文档过期，需要维护者确认。

### 6.7 e2e 测试矩阵

| job | 断言 |
|---|---|
| `linux`（x64、arm64） | 对本次构建的包跑 `install.sh --from … --sums …` → `yonder init` → `service install`，`systemctl --user cat dev.yonder.harness` 内容正确且 `enable --now` 成功（runner 上用户会话 systemd 是否可用未核实，不可用则降级为只断言单元文件内容）→ 再装同版本 `updated:false` → 装下一版本，`current` 指向正确、`.yonder-install.json` 正确 → 篡改包字节，安装失败且 `current` 不变 → 故障注入（解压中途失败）后 `current` 不变 → `service uninstall`（home 保留）→ `uninstall --purge`（home 被删）→ 再次 uninstall 退出码 0 |
| `windows`（x64、arm64） | `install.ps1 -Pkg …` → `init` → `service install`，`schtasks /Query /TN "Yonder Harness"` 存在，`service.json` 存在 → `yonder sessions list` 经命名管道返回 → 超 262 字符前缀被拒 → 创建第二个本地用户，用 `runas`/`Start-Process -Credential` 断言管道拒绝访问（`docs/spec/09-cli-release.md:96` 的验收门槛，runner 是管理员，可建用户，未实测）→ junction 切换与回滚 → `uninstall`（任务被删，home 保留）→ `--purge` |
| `macos`（arm64；x64 同脚本串行） | 用临时用户 `sysadminctl -addUser`（需 sudo，runner 具备，未实测）跑真实 launchd：`install.sh` → `service install`，`launchctl print gui/<uid>/dev.yonder.harness` 已加载 → `update` → `service uninstall` 后 Label 不再存在 → 旧版 home 存在时 `migrate` 的 `--dry-run` 输出与实际结果一致 |
| 迁移专项（linux） | 构造旧布局（旧 home 路径加旧插件 id），`migrate` 幂等跑两次，第二次无改动 |
| 代理/离线（linux） | 设置 `HTTPS_PROXY` 指向本地代理确认走代理；`--from` 离线安装不发任何网络请求（用 `unshare -n` 或断网命名空间验证，Linux 专用） |

## 7. 本机减负

### 7.1 哪些脚本迁走

| 现有脚本（`research/D1-local-pipelines.md`） | 去向 |
|---|---|
| `npm test` 全量 vitest | `ci.yml` 的 `test-linux`、`test-win`；本机改为 `npm run test:changed` |
| `scripts/test-service-host*.mjs`（9 个）、`test-helper-install.mjs` | `ci-heavy.yml` 的 `service-host`、`helper-install`（macos-15，串行） |
| `swift build` / `swift test --package-path packages/macos-helper` | `ci.yml` 的 `swift`（改动相关时）、`ci-heavy.yml` |
| `scripts/yonder-permissions.mjs self-check` | `ci.yml` 的 `swift`（已在 CI 中，3 分钟左右） |
| 安装/卸载/迁移 e2e | `e2e-install.yml` |
| `YONDER_TEST_REAL=1 npm test` | `real-model.yml` |
| `scripts/test-credential-tty.py`、`check-event-notifications.py` | `ci-heavy.yml` 的 `full-matrix` 里的 linux job（Linux PTY 语义需验证，未验证） |
| 发版：改 26 份 manifest、tag、`gh release create` | `release-prepare.yml`、`release-tag.yml`、`release.yml` |

留在本机、不迁：`check-awake-runtime.mjs`、`check-power-live.mjs`（依赖主人本机常驻服务）、`accept-hermes-official.mjs`、`accept-plugin-slash-routing.mjs`（依赖外部私有仓和凭据）、`sync-pi-durable.mjs`、`bundle-pi-ai.mjs`（跨仓手动流程，pi fork 不在本设计范围）。

### 7.2 本机留下什么

- `npm run test:changed`：`vitest run --changed --maxWorkers=2`。只跑与未提交改动相关的测试。
- `npm run typecheck`、`npm run lint`：保留，速度可接受。
- 重型脚本在入口处检查 `YONDER_HEAVY=1`，没有就打印提示「请用 `npm run ci:remote`，或显式设置 `YONDER_HEAVY=1`」并退出码 2。涉及 `test-service-host*.mjs`、`test-helper-install.mjs`、`swift test` 的 npm script，以及 `npm test` 的全量模式。

### 7.3 `npm run ci:remote`

`scripts/ci-remote.mjs`（新增）：

1. 取当前分支 `git rev-parse --abbrev-ref HEAD`。要求工作区干净，且本地提交已推送（`git rev-parse HEAD` 等于 `git rev-parse @{u}`）。不满足则报错并给出建议，脚本自己不推送。
2. `gh workflow run ci-heavy.yml --ref <branch> -f suite=${SUITE:-all}`。
3. 轮询 `gh run list --workflow ci-heavy.yml --branch <branch> --event workflow_dispatch --limit 1 --json databaseId,createdAt`，选创建时间晚于触发时刻的那条。
4. `gh run watch <id> --exit-status`。
5. 失败时 `gh run view <id> --log-failed | tail -n 80`，并打印 run URL。

前提：`workflow_dispatch` 要求 workflow 文件已存在于默认分支才能被识别，所以 S1 必须先把 `ci-heavy.yml` 合并到 main。`suite` 取值：`all`、`service-host`、`install`、`swift`。

### 7.4 heavy lock 的去留

- Actions 里不需要 `/tmp/yonder-heavy-test.lock`，用 `concurrency` 组代替（§4.2）。
- 本机只在显式开启 `YONDER_HEAVY=1` 时仍然取该锁，防止两个终端同时跑重型脚本，沿用 `research/C4-install.md` §5.4 第 6 条的并行度上限 1。

## 8. 多端

### 8.1 桌面（Tauri 2）

- 工程：`apps/desktop/src-tauri`（`design.md` §4.6，`@yonder/desktop`）。当前仓库没有 `apps/`，这些路径是目标位置。
- 核心运行时作为 sidecar。Tauri 的 `externalBin` 要求单个可执行文件，文件名带 target triple（`binaries/my-sidecar-aarch64-apple-darwin`，`v2.tauri.app/develop/sidecar/`）。Yonder 的运行时是目录（Node 加 `app/` 树）。做法：
  - `externalBin` 只放一个 Node 二进制副本，命名为 `binaries/yonder-node-<triple>`；
  - 运行时的 `app/` 树用 `bundle.resources` 打进去；
  - 壳启动时 `yonder-node <resources>/app/…/cli/dist/index.js`。
  构建脚本 `scripts/prepare-desktop-sidecar.mjs`（新增）从 `runtime` job 的产物取文件。
- macOS 签名要点（`design.md` §4.6）：
  - 自带的 Node 和所有 `.node` 文件、`Yonder Helper.app` 都要 hardened runtime 签名。Tauri 只对它自己管理的二进制签名，`resources` 里的文件要在 `tauri build` 之前手动 `codesign`。
  - Node 需要 entitlements：`com.apple.security.cs.allow-jit`、`com.apple.security.cs.allow-unsigned-executable-memory`，加载非同一 Team 签名的 `.node` 还需 `com.apple.security.cs.disable-library-validation`（凭记忆，S4 公证时实测）。
  - 没有 Apple 账号时：`APPLE_SIGNING_IDENTITY="-"` 做 ad-hoc，不公证。边界：浏览器下载的 dmg 会被 Gatekeeper 拦截，用户需右键打开或执行 `xattr -dr com.apple.quarantine`；`install.sh` 用 `curl` 下载不带隔离属性，不受影响。Helper 的 TCC 授权绑定代码身份，ad-hoc 每次构建的 CDHash 都不同，所以升级后权限会被重置。这是 Apple 账号到位前最大的体验缺口，要在发布说明里写明。
- Windows：先发未签名版，SmartScreen 会警告（`design.md` §4.6 同结论）。SignPath 通过后签名，见 §8.4。
- Linux：AppImage、deb、rpm，附 `SHA256SUMS` 和 minisign 签名。arm64 的 AppImage 在 Tauri bundler 上是否可用未核实，S5 实测，不行则 arm64 只出 deb 和 rpm。
- 更新：`bundle.createUpdaterArtifacts: true`，公钥写入 `tauri.conf.json` 的 `plugins.updater.pubkey`，私钥放 `release` 环境，构建时注入 `TAURI_SIGNING_PRIVATE_KEY`（`.env` 文件不生效，`research/C4-install.md` §4.2）。`latest.json` 由 `make-latest-json.mjs` 生成。Tauri 先校验整份文件再比版本，任何平台条目缺失都会整体失败，所以脚本必须校验 6 个平台条目齐全。
- CI 验证（`desktop` job 内）：每个平台构建后做冒烟，启动 App（Linux 用 `xvfb-run`），断言 sidecar 就绪、`gateway.json` 生成、窗口加载 `/`。更新按钮的完整交互无法在 runner 上断言，仍按 `research/C4-install.md` §6.2 的 L6，用虚拟机人工走查。
- Tauri spike 的三项硬指标（`design.md` §4.6）未通过时改用 Electron。本设计的 runner 分配和 `release-manifest.json` 不受影响，只需把 `desktop` job 的构建命令换成 `electron-builder`，`latest.json` 换成 `latest.yml`。

### 8.2 Android

- runner：`ubuntu-24.04`。GitHub 托管 macOS 镜像清单里已有 Android SDK 与 NDK 27.3/28.2/29.0（`runner-images` 的 macos-15-arm64 README）；Linux 镜像也预装 Android SDK，具体 NDK 版本以 `ubuntu-24.04` 的 README 为准，S6 第一步先核对（未核实）。
- 前提（`v2.tauri.app/start/prerequisites/`）：JDK、`JAVA_HOME`、`ANDROID_HOME`、`NDK_HOME`、SDK Platform、Platform-Tools、NDK（side by side）。构建前执行 `rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android`。
- 命令：`npm run tauri android build -- --apk --aab`。
- 签名（`v2.tauri.app/distribute/sign/android/`）：在 `gen/android/app/build.gradle.kts` 引用 `keystore.properties`。CI 里从 `release` 环境的 `ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD` 现场写出 `keystore.properties` 和 keystore 文件，用完删除。
- 分发：签名 APK 放 Release。AAB 仅在上 Play 时使用，保留 keystore 备份是主人的责任，丢失无法恢复（Play 的上传密钥可重置，但自分发 APK 不行）。
- sidecar 不可用：手机端不带运行时，只连远端完整节点。设计：`tauri.android.conf.json` 和 `tauri.ios.conf.json` 用 JSON merge patch 把 `bundle.externalBin` 与 `bundle.resources` 置空。Tauri 2 支持按平台命名的配置文件（凭记忆，S6 spike 实测）。sidecar 不适用于移动端的原因是推断：iOS 不允许应用启动自带的外部可执行文件，Android 对应用数据目录里的可执行文件有执行限制。`v2.tauri.app/develop/sidecar/` 页面本身没有明说，所以 S6 要在移动端构建时确认没有 `externalBin` 残留。

### 8.3 iOS

- runner：`macos-26`。Apple 要求上架应用使用较新 Xcode 的 SDK（具体门槛凭记忆，未核实），模拟器构建在 `macos-15` 也可，iOS 统一用 `macos-26` 并在 job 里 `sudo xcode-select -s` 到镜像预装的最高稳定版 Xcode，版本以 `runner-images` 的 macos-26 README 为准。`research/D0-actions-free-tier.md` 列出了 `xcode-27` 标签，作为预览版不用。
- 到位前（无 Apple 账号）：只做模拟器构建 `tauri ios build --target aarch64-sim`（目标名以 Tauri 当时版本为准），产物 zip 作为 7 天 artifact，不进 Release，不签名。边界：不能装真机，不能 TestFlight。
- Apple 账号到位后：证书与描述文件放 `release` 环境（`IOS_CERTIFICATE`、`IOS_CERTIFICATE_PASSWORD`、`IOS_MOBILE_PROVISION`），或用 App Store Connect API key 自动签名；ipa 经 App Store Connect API 上传到 TestFlight。Tauri 说明签名需要一台 Apple 设备或 Apple 环境，GitHub 托管的 macOS runner 满足该条件（`v2.tauri.app/distribute/sign/ios/`）。
- 同样 `tauri.ios.conf.json` 置空 sidecar。

### 8.4 Windows 签名：SignPath Foundation

条件（`signpath.org/terms` 实际抓取）：

| 条件 | Yonder 现状 |
|---|---|
| 使用 OSI 批准的开源许可，无商业双许可 | 主仓为 Apache-2.0（`package.json` 的 `license`，`LICENSE`），满足 |
| 项目内没有专有闭源组件 | 主仓公开。`yonder-cloud` 是私有的，但不进入被签名的包 |
| 项目持续维护 | 满足 |
| **已经以待签名的形式发布过** | 当前不满足，Release 没有二进制。所以必须先发布一个未签名的 Windows 版本，再申请 |
| 签名团队就是开发和维护团队 | 满足 |
| 软件不得包含专门用于发现或利用安全漏洞、规避运行环境安全措施的功能 | 需要自查：`plugins/native-automation` 和 macOS Helper（引导权限授权）是否会被判定为规避系统安全措施，主要影响 macOS 部分；Windows 包是否包含 native-automation 须在申请前确认（未核实） |
| 证书颁发给 SignPath Foundation，发布者名显示为 SignPath Foundation | 须接受 |

另外 SignPath 要求：公开的代码签名策略页面、隐私声明、构建须在 GitHub 托管 runner 上经其 GitHub connector 提交（具体要求以申请时文档为准，未核实）。

CI 接入（S4）：`desktop` 和 `runtime` 的 Windows job 先上传未签名 artifact，再用 `signpath/github-action-submit-signing-request` 提交，取回已签名文件，替换后再继续打包。签名请求使用 `SIGNPATH_API_TOKEN`（放 `release` 环境）。Windows 的 `node.exe` 已由 OpenJS 签名，不重签。

备选 Azure Trusted Signing：资格限制严，大陆主体可能不被接受（未核实）。若 SignPath 被拒，另选商业 OV/EV 代码签名证书，成本与 HSM 要求不在本设计范围，列入 §13.1。

### 8.5 Web 与 PWA

- `apps/app` 构建产物打成 `yonder-web-<v>.tar.gz`，同时放入每个运行时包的 `app/web/`，由网关托管。
- `yonder-cloud` 的 `deploy.yml` 下载同一个 tarball，校验后发布到站点，同时提供 PWA。PWA 的 `manifest.webmanifest` 与 service worker 随前端构建一起产出，不在 CI 里另做一遍。
- CI 验证：`build-web` 完成后，用 Playwright 或项目已有的 `web-verify-local-chrome` 脚本做一次启动加载冒烟（在 `ubuntu-24.04` 上，Chrome 已预装）。

## 9. yonder-cloud 部署链

### 9.1 CI（私有仓，仅 Linux）

`ci.yml`：

```yaml
name: CI
on: { pull_request: , push: { branches: [main] } }
permissions: {}
concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }
jobs:
  server:
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    permissions: { contents: read }
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_PASSWORD: ci, POSTGRES_DB: yonder_card_test }
        options: >-
          --health-cmd "pg_isready -U postgres" --health-interval 5s --health-retries 10
        ports: ['5432:5432']
      redis:
        image: redis:7
        options: --health-cmd "redis-cli ping" --health-interval 5s --health-retries 10
        ports: ['6379:6379']
    steps:
      - uses: actions/checkout@<sha>
        with: { persist-credentials: false }
      - uses: actions/setup-node@<sha>
        with: { node-version: 24, cache: npm, cache-dependency-path: server/package-lock.json }
      - run: cd server && npm ci && npm run build && npm test   # test-concurrency=1，沿用现有
      - run: npm run deploy:test                                 # deploy/test.mjs 离线断言
```

`DATABASE_URL`、`REDIS_URL` 指向服务容器。`server/package.json:7` 要求 Node ≥24 <25。postgres 和 redis 镜像版本以生产环境版本为准，需主人确认（未核实）。

### 9.2 部署

`deploy.yml`：`workflow_dispatch`（输入 `web_version`，默认读仓库内 `web-version.txt`），以及 push main 时只跑 `plan`，不发布。

1. `build`（ubuntu，不需要密钥）：
   - `curl` 下载 `yonder-web-<v>.tar.gz`、`SHA256SUMS`，`sha256sum -c`；
   - `gh attestation verify yonder-web-<v>.tar.gz --repo GoYonderTogether/yonder`（公开仓的 attestation，读取不需要私有凭据）；
   - `server` 构建；打包成 release 目录；生成 `build-version.json` 和 `RELEASE`。
2. `deploy`：
   - `environment: production`，配置 required reviewers，审批通过才执行；
   - `concurrency: {group: production-deploy, cancel-in-progress: false}`；
   - 从环境密钥读 `DEPLOY_SSH_KEY`、`DEPLOY_KNOWN_HOSTS`、`SERVER_ENV`（现 `server.env` 的内容）；
   - 经一条 SSH 连接上传并触发远端安装，命令形如 `ssh -i key deploy@host deploy <version>`；
   - 远端安装沿用 `deploy/install.sh` 的现有步骤：建用户、私有 Node、`npm ci --omit=dev`、跑迁移、原子切 `current` 和 `web/current`、`nginx -t` 后 reload、只重启 `yonder-card.service`、健康检查（`research/D1-local-pipelines.md` §三）；
   - 部署后在 runner 上对 `https://yonder.zethai.cn` 的健康端点再探测一次。
3. `rollback.yml`：同样走 `production` 审批，远端执行 `rollback`（交换 `current`/`previous`，迁移与 env 不回退，沿用 `deploy/rollback.sh` 语义）。

### 9.3 受限部署用户

- 服务器上建专用用户 `yonder-deploy`，不用 root。
- `~yonder-deploy/.ssh/authorized_keys` 里这把 key 的前缀：`command="/opt/yonder-card/bin/deploy-gate",restrict,no-pty,no-agent-forwarding,no-port-forwarding,no-X11-forwarding`。
- `deploy-gate` 是 root 拥有、不可由部署用户修改的脚本，只接受三个动作：`deploy <version>`（从 stdin 收包，写入 `incoming/`，校验传入的 SHA256，再调用 root 拥有的固定路径 `install.sh`）、`rollback`、`status`。其余输入一律拒绝。读取 `SSH_ORIGINAL_COMMAND` 做白名单匹配。
- `install.sh` 需要的特权操作通过 `sudoers` 白名单限定：`systemctl restart yonder-card`、`nginx -t`、`systemctl reload nginx`、对 `/opt/yonder-card` 的写入。
- 这与 `command=` 强制执行 `install.sh` 的已定决策一致，差别是 `install.sh` 不随包上传，而是服务器上预置的受控副本，避免持 key 者通过包内容执行任意代码。需要先做一次性配置，不由 Actions 自动完成。
- 保留一次性运维动作为手工：`provision-db.sh`（需 Postgres 管理员密码）、`decommission-old.sh`、`dev.mjs` 系列。这些不进 Actions。

### 9.4 连通性与防火墙

GitHub 托管 runner 在境外，目标是阿里云国内机房（`yonder.zethai.cn`）：

- 连通性：跨境 SSH 会受丢包和延迟影响（未实测）。在 `deploy` job 里给 `ssh` 设 `ConnectTimeout=20`、`ServerAliveInterval=15`、`ServerAliveCountMax=4`，整个 job `timeout-minutes: 15`，失败后重试一次，禁止无限重试。
- 防火墙：GitHub runner 的出口 IP 范围很大（`api.github.com/meta` 的 `actions` 字段，数千个网段），无法在安全组里逐个放行。做法：SSH 端口对公网开放，仅靠密钥认证、`restrict`、强制命令、`fail2ban`、可选改非标准端口来防护。需要主人在阿里云安全组确认端口策略。
- 备选（连通性差时）：服务器侧拉取。服务器上的 systemd timer 定期读取受信任的版本指针，下载公开仓的产物并用同样的校验流程安装，不需要入站 SSH。部署先用推（SSH 加 `deploy-gate`），跨境 SSH 不稳定时再改为拉（§13.3）。
- 现有 `deploy/net.sh` 为绕过本机 Clash 而写，在 Actions 里不需要，迁移时删除相关逻辑。

### 9.5 预算

- 组织 Billing → Budgets：Actions 预算设为 $0，勾选「Stop usage when budget limit is reached」。
- 私有仓 artifact `retention-days: 1`，存储上限 500 MB。

## 10. 安全模型

### 10.1 公开仓

| 措施 | 做法 |
|---|---|
| Actions 固定到 SHA | 所有 `uses:` 写 40 位 SHA 并附版本注释；Dependabot 的 `github-actions` 生态更新这些 SHA。首次由 S1 手工解析，不使用来历不明的批量脚本 |
| 最小权限 | 每个 workflow 顶层 `permissions: {}`，job 级别按需声明；仓库设置里默认 `GITHUB_TOKEN` 为只读 |
| 密钥范围 | 密钥只放在 environment：`release`、`production`（私有仓）、`real-model`。仓库级 secret 不放任何生产密钥 |
| 环境保护 | `release`：部署限制为 `v*` tag 与 main；`real-model`：限制为 main；`production`：required reviewers |
| `pull_request` | 不使用任何密钥；fork 的 PR 在仓库设置里要求外部协作者首次审批 |
| 禁止 `pull_request_target` | 不使用该触发器；`actionlint`/`zizmor` 检查在 `ci.yml` 里强制 |
| 不用 `persist-credentials` | `actions/checkout` 一律 `persist-credentials: false` |
| tag 规则集 | 只允许维护者推 `v*`，GitHub App 在 bypass 列表；`channel-*` 滚动 tag 只允许 App |
| 分支规则集 | main 需要 PR、必需检查（`static`、`test-linux`、`test-win`）、禁止强推 |
| 其他 | secret scanning 与 push protection 打开；CODEOWNERS 覆盖 `.github/`、`scripts/install.*`、`release/` |
| 供应链 | 全部 Release 资产附 `SHA256SUMS`、minisign 签名与 `attest-build-provenance`；Docker 镜像同样做 attestation；npm 带 provenance |

`release` 环境没有 required reviewers。原因：6 路矩阵每个 job 都引用该环境，设了审批会在每个 job 弹出确认（多个 job 是否合并成一次审批未核实，不依赖这一点）。人工把关放在两处：发版 PR 的审阅合并，以及 tag 规则集。不设 draft 转 published 前的二次确认环境（主人已授权主 Agent 负责发版；只有 `production` 部署保留审批，见 §13.3 的建议）。

### 10.2 密钥清单

| 名称 | 环境 | 用途 |
|---|---|---|
| `APP_ID`、`APP_PRIVATE_KEY` | `release` | GitHub App token（发版 PR、tag、tap、bucket） |
| `APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_SIGNING_IDENTITY` | `release` | macOS 签名；到位前缺省即 ad-hoc |
| `APPLE_API_ISSUER`、`APPLE_API_KEY`、`APPLE_API_KEY_CONTENT` | `release` | 公证、TestFlight |
| `TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | `release` | updater 签名 |
| `MINISIGN_KEY` | `release` | 签 `SHA256SUMS` |
| `SIGNPATH_API_TOKEN` | `release` | Windows 签名 |
| `ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD` | `release` | Android 签名 |
| `NPM_TOKEN`（仅首次发布） | `release` | 之后改用 npm Trusted Publishing（OIDC），删除此 token |
| `YONDER_TEST_API_KEY` | `real-model` | 真实模型测试，专用 key，限额 |
| `DEPLOY_SSH_KEY`、`DEPLOY_KNOWN_HOSTS`、`SERVER_ENV` | `production`（私有仓） | 部署 |

不复制 OAuth：`CONTRIBUTING.md` 规定每个 home 独立 OAuth，禁止复制，所以 `real-model` 用 API key。没有该 key 时测试记为「未测：缺少凭据」并跳过，而不是失败。

### 10.3 免费额度核算

公开仓标准 runner 不计费，不受 2,000 分钟约束（`research/D0-actions-free-tier.md`）。下表仅用于估算排队压力。

| workflow | 次/月 | 分钟/次（job 合计） | 小计 |
|---|---|---|---|
| `ci.yml`（Linux 约 11、Windows 约 12、Swift 约 10×30%） | 约 120 | 约 26 | 约 3,100 |
| `ci-heavy.yml`（nightly 30 次，加手动 30 次） | 60 | 约 120 | 约 7,200 |
| `e2e-install.yml` | 30 | 约 100 | 约 3,000 |
| `release.yml`（每月约 6 次） | 6 | 约 220 | 约 1,300 |
| `real-model.yml` | 30 | 约 10 | 约 300 |

这些都在公开仓，合计约 1.5 万分钟，不计费。需要关注的是并发而不是总量：macOS 约 3,500 分钟，按 5 个并发上限排队，nightly 错开到 UTC 凌晨避开白天开发。

私有仓 `yonder-cloud`（Linux 倍率 1）：

| workflow | 次/月 | 分钟/次 | 小计 |
|---|---|---|---|
| `ci.yml` | 30–40 | 约 5 | 150–200 |
| `deploy.yml` | 8–10 | 约 4 | 32–40 |
| `rollback.yml` | 0–2 | 约 2 | 0–4 |
| 合计 | | | 约 180–245 |

约占 2,000 分钟的 12%。留足余量，加预算 $0 加超额即停兜底。

缓存与保留：`actions/cache` 单仓上限 10 GB，按 LRU 淘汰；npm 用 `setup-node` 的 `cache: npm`，Rust 用 `~/.cargo/registry`、`target` 按 `Cargo.lock` 哈希缓存。所有 `upload-artifact` 设 `retention-days: 7`（私有仓设 1）。所有 workflow 设 `concurrency` 取消同分支旧运行（release 与 production 部署例外，不取消）。

## 11. 落地阶段

| 阶段 | 内容 | 验收条件 |
|---|---|---|
| **S1 立刻减负** | 合并 `ci.yml`（Linux、Windows、Swift 条件 job）、`ci-heavy.yml`、`scripts/ci-remote.mjs`、`npm run test:changed`、`build:core`、重型脚本的 `YONDER_HEAVY` 开关、`scripts/version-check.mjs`（`--check` 先行）、`dependabot.yml`；组织预算 $0；仓库安全设置（默认只读 token、规则集、secret scanning） | ① `npm run ci:remote` 在一个测试分支上跑完 `ci-heavy` 并返回正确退出码，失败时打印日志尾部；② 不设 `YONDER_HEAVY` 时重型脚本退出码 2 并提示；③ 本机 `npm run test:changed` 在 30 秒内返回；④ 一个 fork PR 的 workflow 运行里 `secrets` 为空（用测试 fork 实测）；⑤ `version-check.mjs --check` 在当前仓库通过，故意改一份 `package.json` 版本则失败 |
| **S2 产物与安装** | `pack-runtime.mjs`、6 平台运行时包、`SHA256SUMS`/minisign/attestation、`install.sh`/`install.ps1`、`yonder install`/`uninstall`/`update`（预构建）/`migrate` 的代码、`e2e-install.yml`、`release-prepare`/`release-tag`/`release`（只到 GitHub Release，不含 npm/tap/桌面）、`docker.yml`、仓库改名、tap 与 bucket 空仓 | ① 发一个 `-beta.1`，Release 上有 6 个运行时包、`SHA256SUMS`、`release-manifest.json`；② `e2e-install` 五个 job 全绿，含篡改字节被拒、同版本幂等、卸载后 home 保留；③ 在一台干净的 Linux 机器上 `curl … \| sh` 一次成功；④ `docker pull` 在 amd64 和 arm64 上都能 `yonder version`；⑤ GHCR 包已改为 public |
| **S3 云部署与真实模型** | `yonder-cloud` 的 `ci.yml`/`deploy.yml`/`rollback.yml`；服务器 `deploy-gate`、`yonder-deploy` 用户、sudoers 白名单；`real-model.yml` 和 environment | ① `deploy.yml` 的 `plan` 与本机现有 `--plan` 输出一致（SSH 次数、env 不泄漏断言保留）；② 一次真实部署经审批完成，健康检查通过，`rollback.yml` 能回到上一版；③ 使用错误命令的 SSH 被 `deploy-gate` 拒绝；④ `real-model` nightly 有凭据时通过，删除凭据后记为「未测：缺少凭据」而不是失败；⑤ 私有仓当月用量 < 300 分钟 |
| **S4 签名与包管理器** | macOS Developer ID 与公证（Apple 账号到位后）；SignPath 申请（需已有 S2 的未签名版本）；npm 首发与 Trusted Publishing；tap 与 bucket 自动更新；`post-publish` | ① `spctl -a -vv` 与 `stapler validate` 通过（有账号时）；无账号时发布说明含 ad-hoc 边界；② `brew install goyondertogether/tap/yonder` 与 `scoop install yonder` 在对应机器上通过；③ `npm i -g @yonder/cli` 安装后 `yonder version` 正确，npm 页面显示 provenance；④ SignPath 申请已提交，结论记录在案 |
| **S5 桌面** | Tauri spike 通过后，6 个桌面目标、`latest.json`、updater、`install --from-app`、桌面冒烟 | ① 三平台各 1 台真机/VM 安装、首启、sidecar 就绪；② 旧版经 updater 更新到新版，数据与 `gateway.json` 保留；③ `latest.json` 6 个条目齐全，缺一个时 `make-latest-json.mjs` 失败；④ MSI 版本号映射在 `windows-2025` 实测通过 |
| **S6 手机** | Android 签名 APK；iOS 模拟器构建；Apple 账号到位后 TestFlight | ① 签名 APK 可安装、能连远端节点；② 构建产物里无 sidecar；③ iOS 模拟器 zip 能在 Simulator 启动；④ 真机与 TestFlight 在账号到位前标注「未测」 |

## 12. 需修改的规格

| 位置 | 现状 | 修改要点 |
|---|---|---|
| `docs/spec/09-cli-release.md` §3–§5 | 发布为 git tag 加用户机 `git clone` 并编译 | 改为预构建运行时包；定义包布局、`.yonder-install.json` 的 `installedBy`、`release-manifest.json`、校验与 minisign；`yonder install --from-app`；两条更新链共用 `.update.lock`（`index.ts:794-826`）；`yonder update` 增加 `--from <本地包>` |
| `docs/spec/09-cli-release.md` §6 附近 | 卸载只有 `service uninstall` | 新增 `yonder uninstall [--purge] [--keep-home]`，清单取 `research/C4-install.md` §3.2 |
| `docs/spec/09-cli-release.md` 迁移 | 无 | `yonder migrate` 的 10 条覆盖点与幂等、并发锁、回滚点 |
| `docs/spec/09-cli-release.md:84-85` | 手动改 26 份 manifest、手动 tag、手动 `gh release create` | 改为 `release-prepare`/`release-tag`/`release`；`version-check.mjs` 的校验范围 |
| `docs/spec/09-cli-release.md:95-97` | Windows 命名管道多用户隔离未验收；不承诺崩溃重启 | 把 `e2e-install` 的 Windows 两账号用例作为验收门槛；说明 Windows 自动更新能力 |
| `plugins/channel-github`（`update-job.ts:107`、`updates.ts:79`） | 调用 `bin/yonder`（无 `.cmd`）；仅 darwin；`yonder update --repo <git>` | 去掉 git 参数；补 `.cmd`；Linux/Windows 的自动更新是否开放由维护者定（C4 现状：仅 macOS） |
| `docs/spec/10-runtime-guarantees.md:51` | tag 与 Release 的关系 | 补充：Release 由 `release.yml` 创建，本地 tag 不构成发版 |
| `docs/spec/12` | 基准 pi 版本及 TUI 边界 | 增加 `apps/desktop` 与移动端的边界（沿用 `AGENTS.md` 第 5 条） |
| `CONTRIBUTING.md` | 本机重型测试、发版手册、`YONDER_TEST_REAL` | 重型测试改为 `npm run ci:remote`；`YONDER_HEAVY=1`；发版流程；`real-model` 环境与「未测」规则；`workflow_dispatch` 的前置条件 |
| `AGENTS.md` | 检查命令指向本机 | 补充：重型验证走 `ci:remote`；改 `.github/` 属需维护者审阅的变更（CODEOWNERS） |
| `docs/decisions.md` | — | 新增：发布源与产物、签名策略、npm 打包方式、渠道（stable/beta）实现、云部署方式 |
| `docs/status.md:196` | 「尚未补跨入口安装锁」 | 与代码 `.update.lock` 不一致，核实后更新 |
| `package.json` | `build` 含 Swift 段 | 新增 `build:core`、`test:changed`、`ci:remote`；`version-check` 脚本 |
| `design.md` §6 | 「同一份 `release/` 构建产物」；Homebrew/winget/scoop 阶段 6 之后 | 更新为本设计的产物矩阵；winget 仍后置 |
| `design.md` §11 阶段 6 | 一条命令安装在三平台干净环境各跑一次 | 以 `e2e-install` 替代手工验证；真机验证仍保留人工走查 |
| `yonder-cloud/deploy/` | 本机 `deploy.sh`、`net.sh`、`install.sh` 随包上传 | 拆成「CI 构建」与「受限 SSH 触发」；`install.sh` 改为服务器预置副本 |

## 13. 风险、未核实项与已定取舍

### 13.1 风险

| 风险 | 影响 | 应对 |
|---|---|---|
| service-host e2e 在 runner 上的进程组、PID 回收、`/usr/bin/open` 行为未验证（`research/D1-local-pipelines.md` §九） | `ci-heavy` 的 `service-host` 可能不稳定 | S1 先以非必需检查运行，连续 10 次绿后再设为必需 |
| `macos-15` arm64 只有 3 核 7 GB，Swift 与 Helper 构建慢 | `swift` job 用时可能超估 | `timeout-minutes: 30`，缓存 SwiftPM |
| 跨境 SSH 到阿里云 | 部署偶发失败 | 超时与一次重试；备选服务器侧拉取（§9.4） |
| 无 Apple 账号期间 Helper 权限随升级重置 | 用户升级后需重新授权 | 发布说明明示；账号到位后改为 Developer ID，TCC 身份稳定 |
| Windows 无签名期间 SmartScreen 警告 | 用户安装体验差 | 先发预览并明示；S4 申请 SignPath |
| 滚动 `channel-beta` Release 与 GitHub 的「不可变 Release」功能冲突（该功能的具体行为未核实） | 若主人开启不可变 Release，beta 通道更新会失败 | 本设计默认不开启；若要开启，改用独立的 `channels` 分支存放清单 |
| `release` 环境无审批 | 任何拿到 `v*` tag 推送权限的人都能触发带密钥的构建 | tag 规则集限定维护者；`verify` 校验提交在 main 祖先链上；不设审批环境，见 §13.3 |
| 单个 maintainer 掌管全部密钥 | 丢失无法恢复 | 备份 Tauri、minisign、Android keystore（私有密码库）；公钥写入仓库 |

### 13.2 未核实项

| 项 | 状态 |
|---|---|
| npm `@yonder` scope | 实测：`registry.npmjs.org/-/v1/search?text=scope:yonder` 返回 0 个包；`@yonder/cli`、`core`、`sdk`、`protocol`、`gateway`、`app`、`desktop` 的 registry 查询均为 404。**无法据此断定 scope 可注册**：npm 的 scope 属于用户或组织，空 scope 也可能已被占用，`npmjs.com/org/yonder` 对本次请求返回 403，没拿到页面。裸名 `yonder` 已被占用（HTTP 200）。需要主人登录 npm 后执行 `npm org create yonder` 或查看 `https://www.npmjs.com/org/yonder`，被占用则改用 `@goyonder` 或 `@yonder-ai`，该改名需同步 `design.md` §3.2 |
| npm 打包 | 已定用 `bundleDependencies`（§13.3）。依据：`packages/core/package.json:21-22` 与 `packages/sdk/package.json:20-21` 依赖 `@earendil-works/pi-ai@1.3.0`、`@earendil-works/pi-durable@1.3.0`；主仓 `package.json:56-60` 用 `overrides` 把 pi-ai 重定向到 `third_party/pi-ai/*.tgz`（fork）；直接发布会让消费者拿到上游 pi-ai |
| 原生模块 | 已核实（见 §3.2）：无 `better-sqlite3`，`node:sqlite` 内置；原生部分只有 pi-tui 全平台预编译和 `@resvg/resvg-js` 的平台 optional dependency。`resvg` 其他平台的 optional 包是否都有 win32-arm64 构建，未核实，S2 在 `windows-11-arm` 上实测 |
| Tauri 移动端构建前提 | 已核实：Xcode、`JAVA_HOME`、`ANDROID_HOME`、`NDK_HOME`、SDK Platform、Platform-Tools、NDK（`v2.tauri.app/start/prerequisites/`）；iOS 签名要 99 美元/年的 Apple Developer 账号加 Apple 设备（`distribute/sign/ios/`）；Android 签名走 `keystore.properties`（`distribute/sign/android/`）。macOS 15 镜像预装 NDK 27.3/28.2/29.0 与 Android Command Line Tools 16.0（`runner-images`）。未核实：`ubuntu-24.04` 镜像的 NDK 版本、`macos-26` 的 Xcode 版本是否满足 Tauri 与 App Store 要求 |
| sidecar 在移动端不可用 | `v2.tauri.app/develop/sidecar/` 页面没有直接说明；依据是移动系统的进程策略，属推断，S6 实测 |
| SignPath Foundation | 已核实申请条件（`signpath.org/terms`，见 §8.4）。「必须已发布」是当前的阻塞项；connector 的技术要求未核实 |
| MSI 版本号上限 | 凭记忆，未核实，S5 实测 |
| 平台配置文件 `tauri.android.conf.json` 等 | 凭记忆，S6 实测 |
| Linux runner 上用户级 systemd | 未核实，`e2e-install` 的 Linux 用例做了降级 |
| 阿里云防火墙与 SSH 端口策略 | 未核实，需要主人确认 |
| `build-macos.mjs` 在非 darwin 上的行为 | 未核实，故拆 `build:core` |
| Windows arm64 的 Tauri 构建、Linux arm64 AppImage | 未核实，S5 实测 |

### 13.3 已定取舍

- **npm 打包。** `@yonder/cli` 用 `bundleDependencies` 带上 fork 的 pi-ai tarball 和 vendored pi-durable，与 `pack-runtime.mjs` 共用裁剪逻辑；不另外发布 fork 包，避免多维护一条发版链。
- **beta 通道。** 滚动 Release `channel-beta`，在 tag 规则集里为 `channel-*` 单独设白名单，只允许 App 推送。不用滚动 tag 时 beta 只能调 GitHub API 列表，会遇到匿名限速。
- **准备发版自动开 PR。** 用 `GITHUB_TOKEN` 开的 PR 不触发 CI，所以引入 GitHub App `yonder-release-bot`，列入外部资源，需主人在网页上创建并安装。
- **MSI 版本。** `0.<minor>.<YYMMDDNN>` 与 MSI 格式可能不兼容（§3.3），Windows 的 `wix.version` 由 `version-check.mjs` 单独生成映射，不影响 NSIS 与 updater。
- **`yonder migrate`。** 当前不存在（`research/C4-install.md` §0），`install.sh` 的 migrate 分支随 S2 的 `yonder migrate` 一起验收。
- **校验。** minisign 签 `SHA256SUMS`：同源 SHA256 只防传输损坏，`gh attestation verify` 需要用户装 `gh`。
- **发布审批。** 不设 `publish` 审批环境；只有 `production` 部署保留审批。
- **部署方式。** 先用推（SSH 加 `deploy-gate`）；跨境 SSH 不稳定时改为服务器侧拉取，代价是部署延迟和回滚响应变慢。
- **npm scope。** `@yonder` 是否可注册需要主人登录 npm 查看。被占用就整体改用 `@goyonder`，并同步 `design.md` §3.2。

### 13.4 决定记录

- 10-27：npm 打包选 `bundleDependencies`。
- 10-27：接受滚动 Release `channel-beta` 与 GitHub App `yonder-release-bot`。
- 10-27：接受 MSI 版本单独映射、minisign 签 `SHA256SUMS`。
- 10-27：不设 `publish` 审批环境，主人授权主 Agent 负责发版。
- 10-27：部署先推后拉。
- 10-27：安装目录与 `design.md` §3 对齐（`~/.local/share/yonder/{runtime,home}`、`~/.local/bin/yonder`）。
