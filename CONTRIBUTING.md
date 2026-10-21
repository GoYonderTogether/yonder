# 参与开发

先读 [docs/index.md](docs/index.md) 和 [docs/architecture.md](docs/architecture.md)。规范在 [docs/spec/](docs/spec/)，是代码的目标：代码与文档不一致时以文档为准；要改设计，先改文档，并在 [docs/decisions.md](docs/decisions.md) 记一条，删掉过时内容而不是追加。当前实现状态与已知缺口见 [docs/status.md](docs/status.md)。

*English summary: read `docs/index.md` and `docs/architecture.md` first; the spec in `docs/spec/` is the target. Run `npm run build && npm run typecheck && npm test && npm run lint` before sending changes. Tests that need a model use a real model, never a mock; without credentials they are skipped and reported as "not tested".*

## 仓库布局

```
packages/
  sdk/      @yonder/sdk    插件 API 类型、define* 辅助函数、testing/checkPlugin
  core/     @yonder/core   内核；src/runtime/ 是唯一 import pi 运行时的目录
  cli/      @yonder/cli    yonder 命令与终端界面
  macos/                   macOS 状态栏
plugins/                   官方插件，每个是独立 npm workspace 包，只依赖 @yonder/sdk
skills/                    随发行内置的 skill
patches/                   对固定版本 pi-durable 的边界补丁（postinstall 应用）
```

工具链：Node ≥ 22.19、TypeScript、npm workspaces、vitest、Biome。

## 改动前

1. 在干净分支上工作。只改本次改动涉及的路径；规范没写的行为、命令、字段、配置项不要发明。遇到规范空白或矛盾，写进 issue 或 PR 说明，由维护者决定，不自行补设计。
2. 能复用现有代码、pi、标准库或已装依赖就直接复用。新依赖精确锁版本。
3. 一个逻辑改动一个提交。对外可见的变化记在 `CHANGELOG.md` 顶部的 `## [Unreleased]`。

## 边界（违反即为缺陷）

- 架构不变量见 [docs/architecture.md](docs/architecture.md) 第 5 节，任何时候都不能违反。
- pi 的模型/会话运行包只能在 `packages/core/src/runtime/` 里 import；`@yonder/sdk` 只能 `import type`。插件只依赖 `@yonder/sdk`，不 import core、pi 或兄弟插件的内部代码。
- `packages/cli/` 可以使用 pi-tui 及 coding-agent 的 UI/主题/键位导出，或按许可提取的界面模块；不得接入 coding-agent 的第二套运行或存储系统，不得自行重设计布局和交互（见 [spec/12](docs/spec/12-terminal-interaction.md)）。
- 不写模拟模型、假数据、示例人设、占位功能。
- 修改 `docs/spec/`、`docs/architecture.md`、`docs/decisions.md` 与 `AGENTS.md` 属于设计变更，需要维护者审核。

## 检查与测试

```sh
npm ci
npm run build && npm run typecheck && npm test && npm run lint
```

默认测试不调用模型。需要模型的用例用真实模型 `openai/gpt-6-luna`，显式启用：

```sh
YONDER_TEST_REAL=1 npm test
```

凭据路径取环境变量 `YONDER_TEST_AUTH`，默认 `<仓库>/.yonder/auth.json`（已被 `.gitignore` 忽略）。凭据只由受信任的运行程序读取，不打印内容。OAuth 每个 home 独立登录，禁止复制其他程序的 OAuth。缺凭据时用例被跳过：记为“未测：缺少凭据”，不要伪装通过。

结果记录要写清楚原始计数（通过/失败/跳过）、失败原因和未测项，不用最新的成功覆盖已发生的失败。

## 许可

Apache-2.0。移植第三方代码时保留来源与许可记录（见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和各插件的 NOTICE）。
