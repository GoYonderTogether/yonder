# Yonder Harness

**English** · [中文](README.zh-CN.md)

Yonder Harness is a local agent runtime. It routes incoming events to agents and sessions, runs their work, and returns results through channels. Plugins provide channels, tools, context, execution environments, and skills.

The runtime uses pi (`pi-ai` and `pi-durable`) as dependencies for model access and durable agent sessions. The product is Yonder Harness; pi is an underlying dependency and upstream source.

> **Status:** Developer preview, macOS only. The kernel, CLI and terminal UI, installer/updater and twelve official plugins run end to end, but a fresh install enables only the CLI channel and workspace context files; every other capability is opt-in configuration. [docs/status.md](docs/status.md) records what is verified, what is missing and what is still untested.

## Run from source

Use Node.js 22.19 or newer. From the repository root:

```sh
npm ci
npm run build
node packages/cli/dist/index.js init <home>
node packages/cli/dist/index.js login openai --home <home>
node packages/cli/dist/index.js start --home <home>
```

Replace `<home>` with a directory for this Yonder Harness instance. `start` stays in the foreground. In another terminal, connect to its local CLI channel:

```sh
node packages/cli/dist/index.js chat --home <home>
```

## Install and run as a service

Install a reviewed release tag from a built source checkout:

```sh
node packages/cli/dist/index.js update --to <reviewed-tag> [--repo <repository-url>]
```

The default installation directory is `~/.yonder-harness`; set `YONDER_INSTALL` to choose another location. Add `<install>/bin` to `PATH` to use the `yonder` command. The installation holds versioned program files; `YONDER_HOME` or `--home` selects the separate instance data directory. One installation can serve more than one home.

On macOS, install the launchd service for one home and manage it with:

```sh
yonder service install --home <home>
yonder service status
yonder service restart
yonder service stop
yonder service start
yonder service uninstall
```

Initialize and sign in using the installed executable, then install the service. Do not copy OAuth credentials from another home:

```sh
yonder init <home>
yonder login openai --home <home>
yonder service install --home <home>
yonder chat --home <home>
```

`yonder update --to <reviewed-tag|latest>` updates the installation; `--repo` can select a repository. `yonder version` reports the actual installation and source commit; `yonder changelog` and `yonder docs` read that installed version. Formal GitHub releases and an actual update/notification path are verified; remaining platform and scenario acceptance is recorded separately. Local staging tags are not releases.

## Develop plugins and skills

Plugins depend on `@yonder/sdk` and register contributions through its plugin API. See the [plugin specification](docs/spec/04-plugins.md) for manifests, setup, and contribution slots. A skill is a directory containing `SKILL.md` with a `name` and `description` frontmatter; the [agent specification](docs/spec/03-agents.md#6-skill) describes discovery, indexing, and `skill_view`.

- [Architecture](docs/architecture.md)
- [Specification index](docs/index.md)
- [Project status](docs/status.md) · [Contributing](CONTRIBUTING.md)
- [Official plugins](docs/plugins.md) · [Registered names reference](docs/reference.md)

License: [Apache-2.0](LICENSE)

## Native terminal interaction

`yonder` / `yonder chat` opens the pi 1.3.0 native TUI with Yonder commands and real session data. A new standalone task is created on first submission; `/new`, `/resume`, `/session` and slash/Tab completion use upstream UI components. Use `yonder chat --channel cli` for the existing main-agent channel, `--session <id>` to resume, or `--plain` / `--json` for line-oriented clients. Exiting disconnects the UI without stopping admitted work.

For shell completion, load `source <(yonder completion zsh)` or `source <(yonder completion bash)`; fish uses `yonder completion fish | source`. This does not edit shell configuration. Management commands remain non-interactive. See [the terminal contract](docs/spec/12-terminal-interaction.md) and [third-party notices](THIRD_PARTY_NOTICES.md).


## Global daily entry

After installing, initializing, authenticating and installing the macOS service, run `yonder` from any directory to open the resident CLI channel and its existing main history. `yonder chat` starts a standalone task; `/channel` switches to a resident channel. The installed service home is discovered automatically; explicit `--home` and `YONDER_HOME` still select an isolated development environment. Terminal clients share one resident service.

Bundled `skill-creator` and `yonder-development` use the existing skill index and on-demand `skill_view`; their full instructions are not injected. Plugin source and Git work can live in `<home>/development/<name>` or a user-selected directory. Production code stays in versioned installation directories and is updated with `yonder update`; development homes and credentials stay separate.
