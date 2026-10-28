<div align="center">

# Yonder Harness

**A resident agent kernel. Every message is an event; the harness routes it to the right agent and session, runs the work, and hands the result back. Everything else is a plugin.**

**English** · [简体中文](README.zh-CN.md)

[Status](docs/status.md) · [Documentation](docs/index.md) · [Plugins](docs/plugins.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [License](LICENSE)

[![CI](https://github.com/GoYonderTogether/yonder-harness/actions/workflows/ci.yml/badge.svg)](https://github.com/GoYonderTogether/yonder-harness/actions/workflows/ci.yml) [![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

</div>

> **Developer preview — macOS only.** The kernel, CLI and terminal UI, installer/updater and twelve official plugins run end to end. A fresh install enables only the CLI channel and workspace context files; every other capability is opt-in configuration. [docs/status.md](docs/status.md) records what is verified, what is missing and what is still untested. The specification and reference documents are currently written in Chinese.

## Why Yonder Harness

- **Small kernel, everything pluggable.** The kernel owns events, bindings, identity, sessions, security levels and delivery. Channels, tools, context, triggers, execution environments, hooks, presets and skills come from plugins that depend only on [`@yonder/sdk`](packages/sdk).
- **Events, not chat windows.** Messages from any channel, trigger or other agent become append-only events. Declarative bindings decide which agent, which session and which profile receives each one, and whether the model is woken at all.
- **Durable sessions.** Model access and durable agent sessions use [pi](https://github.com/earendil-works/pi) (`pi-ai`, `pi-durable`) as dependencies. Yonder adds the layer pi does not own: events, channels, bindings, identity, agent workspaces, security levels, delivery and plugins.
- **One security layer.** Capabilities plus levels, checked in two places: whether a tool is offered to the model, and whether a call is allowed. There is no second approval system; approval can be added as a hook plugin.
- **Agents that maintain their own system.** Agents with `exec` can use the `yonder` CLI and `yonder docs`, and the built-in prompts and skills teach them to inspect, configure and extend their own installation.

## How it works

```
channel / trigger / agent_ask ──event──▶ binding ──▶ session ──▶ run (model + tools + skills) ──▶ delivery
                                           │             │                                          │
                                       identity       profile                            back to the input's source /
                                     (who is who)  (model, tools, level)               streaming / proactive send / caller
```

Read [docs/architecture.md](docs/architecture.md) first, then the specifications under [docs/spec/](docs/spec/).

## Quick start

Requirements: macOS, Node.js 22.19 or newer, git. Optional: [ripgrep](https://github.com/BurntSushi/ripgrep) for the `grep` tool, [`gh`](https://cli.github.com) for the GitHub plugin, Chrome or Edge for browser automation.

```sh
git clone https://github.com/GoYonderTogether/yonder-harness.git
cd yonder-harness
npm ci
npm run build
node packages/cli/dist/index.js init ~/yonder-home
node packages/cli/dist/index.js login openai --home ~/yonder-home
node packages/cli/dist/index.js start --home ~/yonder-home
```

`init` creates a home with one agent (`main`, default model `openai/gpt-6-luna`), the CLI channel and workspace context files. `login openai` signs in with a ChatGPT subscription through pi; other providers are configured in `yonder.yaml` ([spec 08](docs/spec/08-config.md), [spec 07](docs/spec/07-runtime.md)). Never copy OAuth credentials from another program or home: refresh tokens rotate, so the copies invalidate each other.

`start` stays in the foreground. In another terminal:

```sh
node packages/cli/dist/index.js chat --home ~/yonder-home
```

This opens the pi 1.3.0 native terminal UI on a standalone, resumable task (the session is created on first send). `/new`, `/resume` and `/session` work as in pi; `/` and Tab complete commands with bilingual descriptions. Closing the UI does not stop admitted work; use `/stop` to abort. See [spec 12](docs/spec/12-terminal-interaction.md).

### Install as a service (macOS)

```sh
node packages/cli/dist/index.js update --to latest   # builds the latest release tag into ~/.yonder-harness/versions
export PATH="$HOME/.yonder-harness/bin:$PATH"
yonder init && yonder login openai
yonder service install                               # launchd service for this home
yonder                                               # attach to the resident main session
```

`yonder service status|restart|stop|start|uninstall` manages the service, `yonder update --check` queries the latest formal release, and `yonder version`, `yonder changelog` and `yonder docs` describe the installed version. The install directory holds program versions; the home holds data, and one install can serve several homes. Details: [spec 09](docs/spec/09-cli-release.md).

### Everyday commands

```sh
yonder chat --channel cli            # the resident main session over the CLI channel
yonder chat --plain                  # line-oriented input and output
yonder sessions list | show <id> | open <preset> | submit <id> --text '…'
yonder events | identity | skills | plugins | models list | inspect | doctor
source <(yonder completion zsh)      # also bash and fish; does not edit shell config
```

Management commands are non-interactive, support `--json`, and use stable exit codes.

## What ships today

| Area | Plugins and built-ins |
|---|---|
| Channels | CLI, MCP server (external agents control Yonder), GitHub (issues, PRs, releases), Feishu/Lark |
| Tools | files, bash with background jobs, ripgrep search, `task_run` subtasks, `agent_ask`, web search and fetch, BrowserSkill browser control, Computer Use bridge, standalone Playwright browser and macOS desktop automation, MCP client, cron scheduler, image generation and speech recognition (SiliconFlow) |
| Context and skills | `AGENTS.md` / `USER.md` / `SOUL.md` / `MEMORY.md` context files; Agent Skills compatible `SKILL.md` directories with on-demand `skill_view`; bundled `skill-creator`, `yonder-development`, `yonder-plugin-debug`, `yonder-self-management` |
| Operations | background tool execution after 15 s, soft time/turn/token reminders, hot agent and preset management, versioned installs with a launchd service, GitHub release → automatic upgrade → notification |

See [docs/plugins.md](docs/plugins.md) for every contribution, event and tool, and [docs/reference.md](docs/reference.md) for registered names.

## Writing plugins and skills

A plugin is an npm package or local directory with a `yonder` manifest in `package.json`. It registers contributions through the SDK's plugin API and depends on nothing from Yonder except [`@yonder/sdk`](packages/sdk); `@yonder/sdk/testing` provides `checkPlugin` for contract tests. A skill is a directory with a `SKILL.md` carrying `name` and `description` frontmatter. Start from the [plugin specification](docs/spec/04-plugins.md), the [agent specification](docs/spec/03-agents.md#6-skill) and the plugins under [plugins/](plugins/).

## Security model

Read this before you point an agent at a machine you care about.

- The owner profile created by `init` runs at level `bypass` with every tool offered. `exec` can run any program, so a Yonder CLI inside an agent's shell is equivalent to administrative control. File-scope rules are not a sandbox.
- Plugins run in the kernel process without isolation. Install only plugins you trust.
- Web pages, logs, quoted messages and other people's messages are treated as data, not instructions, and do not carry the owner's authority.
- Credentials are kept in per-home credential files and read only through the credentials API. See [spec 05](docs/spec/05-security.md).

To report a vulnerability, follow [SECURITY.md](SECURITY.md).

## Documentation

| | |
|---|---|
| [docs/index.md](docs/index.md) | Map of all documents |
| [docs/architecture.md](docs/architecture.md) | Concepts, responsibilities and the invariants nothing may break |
| [docs/spec/](docs/spec/) | Specifications: the target the code is held to |
| [docs/decisions.md](docs/decisions.md) | Why the design is the way it is |
| [docs/status.md](docs/status.md) | What is implemented, what is missing, what is untested |
| [CHANGELOG.md](CHANGELOG.md) | Release notes |

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md). Tests that need a model use a real model, never a mock; without credentials they are skipped and reported as not tested.

## License and acknowledgements

Apache-2.0, see [LICENSE](LICENSE). Yonder Harness builds on [pi](https://github.com/earendil-works/pi) (MIT) and adapts code or protocol behavior from pi's coding-agent, [OpenClaw](https://github.com/openclaw/openclaw), [Hermes Agent](https://github.com/NousResearch/hermes-agent) and Tencent's BrowserSkill under their MIT licenses. Attributions and license texts are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and in the individual plugin directories.

macOS 桌面权限使用稳定签名的 Yonder Helper.app；AI 通过 native-automation_desktop `permissions` 只读查看状态。首次桌面调用安装 helper，授权由主人使用独立 CLI 完成，见[权限与 OWNER STEP](docs/verification/mac-permissions.md)。
