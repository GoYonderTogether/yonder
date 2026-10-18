# Yonder Harness

**English** · [中文](README.zh-CN.md)

A small, resident agent kernel. Every message is an event; the harness routes it to a specific agent and session, runs the work, and delivers the output. Channels, tools, context files, memory, execution environments and guards are plugins.

Built on [pi](https://github.com/earendil-works/pi) (`pi-ai`, `pi-durable`) for model access and the agent runtime.

> Status: **pre-0.1, design stage.** The specification in [`docs/`](docs/index.md) is the target; code follows it.

- [Architecture](docs/architecture.md)
- [Specification](docs/index.md)
- [0.1 tasks](docs/tasks/README.md)

License: [Apache-2.0](LICENSE)
