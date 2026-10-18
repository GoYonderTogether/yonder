# Yonder Harness

**English** · [中文](README.zh-CN.md)

Yonder Harness is a local agent runtime. It routes incoming events to agents and sessions, runs their work, and returns results through channels. Plugins provide channels, tools, context, execution environments, and skills.

The runtime uses pi (`pi-ai` and `pi-durable`) as dependencies for model access and durable agent sessions. The product is Yonder Harness; pi is an underlying dependency and upstream source.

> **Status:** The 0.1 first-pass implementation is ready for review. Full T12 acceptance and formal release, installation, and service verification remain pending.

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

`yonder update --to <reviewed-tag|latest>` updates the installation; `--repo` can select a repository. `yonder version`, `yonder changelog`, and `yonder docs` show the installed version and its release notes and documentation. These release and service paths are part of the first-pass implementation and have not completed formal acceptance.

## Develop plugins and skills

Plugins depend on `@yonder/sdk` and register contributions through its plugin API. See the [plugin specification](docs/spec/04-plugins.md) for manifests, setup, and contribution slots. A skill is a directory containing `SKILL.md` with a `name` and `description` frontmatter; the [agent specification](docs/spec/03-agents.md#6-skill) describes discovery, indexing, and `skill_view`.

- [Architecture](docs/architecture.md)
- [Specification index](docs/index.md)
- [0.1 implementation tasks](docs/tasks/README.md)

License: [Apache-2.0](LICENSE)
