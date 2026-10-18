# Yonder Harness

[English](README.md) · **中文**

Yonder Harness 是本机 Agent 运行时：把收到的事件路由到 Agent 与会话，执行任务，再通过渠道交付结果。渠道、工具、上下文、执行环境和 skills 由插件提供。

模型访问与持久化 Agent 会话使用 pi（`pi-ai`、`pi-durable`）作为依赖。产品名称是 Yonder Harness；pi 是底层依赖及上游来源。

> **状态：** C0–C6 源码整合已完成，待审核验收。全仓构建、类型检查通过；本轮没有新增或运行测试、没有调用外部渠道，也没有替换日用 0.1.4。操作入口及证据边界见 [本轮操作说明](docs/tasks/capability-completion-usage.md)。旧安装版实际证据继续见 [N03](docs/tasks/next/N03-install-agents.md)。

## 从源码运行

需要 Node.js 22.19 或更新版本。在仓库根目录执行：

```sh
npm ci
npm run build
node packages/cli/dist/index.js init <home>
node packages/cli/dist/index.js login openai --home <home>
node packages/cli/dist/index.js start --home <home>
```

将 `<home>` 替换为此 Yonder Harness 实例的数据目录。`start` 在前台运行；另开一个终端进入 pi 1.3.0 原生风格的 TUI（默认独立可续聊任务，首次发送才创建会话）：

```sh
node packages/cli/dist/index.js chat --home <home>
```

`/new` 新任务、`/resume` 继续会话、`/session` 当前信息；`/` 和 Tab 使用原生补全，菜单说明为中英文。模型和工具仍由 Yonder 运行。退出界面不停止后台任务，使用 `/stop` 明确中止。

```sh
node packages/cli/dist/index.js chat --session <id> --home <home>
node packages/cli/dist/index.js chat --channel cli --home <home>  # 常驻 main 的原渠道
node packages/cli/dist/index.js chat --plain --home <home>        # 逐行输入输出
node packages/cli/dist/index.js sessions open default --keep-open --home <home> --json
node packages/cli/dist/index.js sessions submit <id> --text '任务正文' --home <home> --json
```

chat 的默认目标已从 main 渠道改为独立任务。旧 home 没有 default 预设时，在 `/new` 选择实际已有预设；不要假定已安装版本已更新。来源与复用边界见 [终端规范](docs/spec/12-terminal-interaction.md) 和 THIRD_PARTY_NOTICES。

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

## Shell Tab 补全

安装版可输出补全脚本，以下命令只加载到当前 shell，不会修改 shell 配置：

```sh
source <(yonder completion zsh)   # zsh
source <(yonder completion bash)  # bash
# fish: yonder completion fish | source
```

补全可读取当前 `--home` / `YONDER_HOME` 的真实会话、预设和渠道，服务未运行仍可补全静态命令。`--json` 返回单个 `{script, candidates}` 对象，普通管理命令不会弹菜单。

## 开发插件与 skill

插件依赖 `@yonder/sdk`，通过 SDK 插件 API 注册贡献。清单、setup 与各贡献槽见[插件规范](docs/spec/04-plugins.md)。Skill 是含有 `SKILL.md` 的目录，frontmatter 提供 `name` 和 `description`；发现、索引与 `skill_view` 见[Agent 规范](docs/spec/03-agents.md#6-skill)。

- [架构](docs/architecture.md)
- [规范索引](docs/index.md)
- [0.1 实现任务](docs/tasks/README.md)

许可证：[Apache-2.0](LICENSE)
