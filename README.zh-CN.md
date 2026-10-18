# Yonder Harness

[English](README.md) · **中文**

Yonder Harness 是本机 Agent 运行时：把收到的事件路由到 Agent 与会话，执行任务，再通过渠道交付结果。渠道、工具、上下文、执行环境和 skills 由插件提供。

模型访问与持久化 Agent 会话使用 pi（`pi-ai`、`pi-durable`）作为依赖。产品名称是 Yonder Harness；pi 是底层依赖及上游来源。

> **状态：** 正在执行 N00–N14。独立安装与登录、阶段更新、launchd 启停、Luna/Sol 真实工具和 MCP 中止已在本机验证；自主维护闭环与 T12 完整验收尚未完成。证据见 [N03](docs/tasks/next/N03-install-agents.md)。

## 从源码运行

需要 Node.js 22.19 或更新版本。在仓库根目录执行：

```sh
npm ci
npm run build
node packages/cli/dist/index.js init <home>
node packages/cli/dist/index.js login openai --home <home>
node packages/cli/dist/index.js start --home <home>
```

将 `<home>` 替换为此 Yonder Harness 实例的数据目录。`start` 在前台运行；另开一个终端连接本机 CLI 渠道：

```sh
node packages/cli/dist/index.js chat --home <home>
```

## 安装与后台服务

从已构建的源码检出安装经审核的 release tag：

```sh
node packages/cli/dist/index.js update --to <reviewed-tag> [--repo <repository-url>]
```

默认安装目录为 `~/.yonder-harness`，可用 `YONDER_INSTALL` 指定其他位置。把 `<install>/bin` 加入 `PATH` 后即可使用 `yonder` 命令。安装目录保存带版本的程序文件；`YONDER_HOME` 或 `--home` 选择独立的数据目录。一个安装可服务多个 home。

macOS 上可为一个 home 安装 launchd 服务，并用以下命令管理：

```sh
yonder service install --home <home>
yonder service status
yonder service restart
yonder service stop
yonder service start
yonder service uninstall
```

安装后使用安装版初始化、独立登录，再安装服务；不要把其他 home 的 OAuth 复制过来：

```sh
yonder init <home>
yonder login openai --home <home>
yonder service install --home <home>
yonder chat --home <home>
```

`yonder update --to <reviewed-tag|latest>` 更新安装，`--repo` 可指定仓库。`yonder version` 返回实际安装目录和来源 commit；`yonder changelog` 和 `yonder docs` 查看该安装版本的变更记录和文档。正式 GitHub 发布与完整更新验收仍在实施中，本地阶段标签不等于发布。

## 开发插件与 skill

插件依赖 `@yonder/sdk`，通过 SDK 插件 API 注册贡献。清单、setup 与各贡献槽见[插件规范](docs/spec/04-plugins.md)。Skill 是含有 `SKILL.md` 的目录，frontmatter 提供 `name` 和 `description`；发现、索引与 `skill_view` 见[Agent 规范](docs/spec/03-agents.md#6-skill)。

- [架构](docs/architecture.md)
- [规范索引](docs/index.md)
- [0.1 实现任务](docs/tasks/README.md)

许可证：[Apache-2.0](LICENSE)
