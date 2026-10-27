# GitHub Actions 免费额度（10-27 核实）

来源：github/docs 仓库 main 分支原文（`data/reusables/actions/supported-github-runners.md`、`content/billing/reference/product-usage-included.md`、`content/actions/reference/limits.md`），以及 docs.github.com 的 larger runners 页面。

## 免费的
- 公开仓库用标准 GitHub 托管 runner：原文 "Use of the standard GitHub-hosted runners is free and unlimited on public repositories."
- 公开仓库可用的标准标签：
  - Linux x64：`ubuntu-latest`（24.04）、`ubuntu-24.04`、`ubuntu-22.04`、`ubuntu-26.04`；单核 `ubuntu-slim`（容器、无特权，不能跑 Docker）
  - Linux arm64：`ubuntu-24.04-arm`、`ubuntu-22.04-arm`、`ubuntu-26.04-arm`
  - Windows x64：`windows-latest`（2025）、`windows-2025`、`windows-2025-vs2026`、`windows-2022`
  - Windows arm64：`windows-11-arm`、`windows-11-vs2026-arm`
  - macOS Intel：`macos-15-intel`、`macos-26-intel`
  - macOS arm64：`macos-latest`（26）、`macos-14`、`macos-15`、`macos-26`、`xcode-27`
- 自托管 runner 不计费。

## 收费或有限额的
- larger runner（`-large`、`-xlarge`、自定义规格）：公开、私有仓库都按分钟计费，一律不用。
- 私有仓库（Free 组织）：每月 2,000 分钟，Actions 存储 500 MB；Windows、macOS 分钟按更高单价折算（Linux 2 核 $0.006/分钟，Windows 2 核 $0.010/分钟，macOS 更高）。超出部分计费，除非预算设置了 "Stop usage when budget limit is reached"。
- 并发（Free 计划）：总共 20 个并发 job，其中 macOS 最多 5 个，标准和 larger runner 共用这个上限。

## 对设计的约束
1. 所有重型构建、打包、端到端测试都放在公开主仓跑。
2. 私有仓库（yonder-cloud）只跑 Linux 小 job，前端产物从公开仓库的 Release 下载，不在私有仓库重复构建；组织预算设为 $0，开启超额即停。
3. 不使用 larger runner；矩阵里 macOS job 同时不超过 5 个。
4. 公开仓库的 workflow 要防外部 PR 窃取密钥：密钥只放在受保护的 environment 里，`pull_request` 不接触密钥，禁用会 checkout PR 代码的 `pull_request_target`。
