# @yonder/dsh-connector

DeepSeek Harness (DSH) 的 Yonder 连接器，契约见 `docs/spec/23-harness-connector.md`。

它以一个 DSH **bundle 插件**的形态运行：`apply()` 里开一条**出站**连接到你 Yonder 账号的 `/ws/device`，
把本机的 DSH agent 登记成你的 Bot，并把 DSH 自己的会话（列表、打开、输入、转录、中止、事件流）暴露给网页。
不监听任何端口、不复制 DSH 的转录，会话状态仍归 DSH 自己。

## 安装

```sh
npx -y @yonder/connect dsh
```

安装器会：用 `dsh plugin --profile <p> add` 把本包装进你的 profile；向云端申请设备码并打开浏览器确认；
把设备令牌写到 `$DSH_HOME/yonder/config.json`（0600）。重启 DSH 后生效。

卸载：

```sh
npx -y @yonder/connect dsh --remove
```

## 行为与边界

- 状态只在 `$DSH_HOME/yonder/`：`config.json`（端点与设备令牌）与 `state.json`（Bot ↔ 会话映射、投递游标）。
- 不改 `PATH`、不写 `~/.gitconfig`、不写环境变量、不装全局命令；不直接读写 `$DSH_HOME/sessions` 或 `storages`。
- 连接失败只降级：DSH 正常启动，插件只提供 `yonder_status` 工具，并如实说明未连接。
- `engines.dsh` 不满足时 DSH 会跳过本 bundle（`skippedBundles`），启动不受影响。
- 不提供设备执行方法（`tools.*`）；会话驱动只经 `ctx.sessionController` 这一个适配文件。

## 配置

`cordis.patch.yml` 里的这一行可以带配置：

```yaml
- id: yonder-connector
  name: '@yonder/dsh-connector'
  config:
    endpoint: https://yonderbot.net   # 云端地址
    # stateDir: /absolute/path        # 覆盖状态目录
    # toolsOnly: true                 # 只提供状态工具，不建后台连接
```
