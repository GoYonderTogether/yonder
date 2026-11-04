# @yonder/connect

把一个 agent harness 接入 Yonder 账号的命令行安装器。当前支持 DeepSeek Harness（`dsh`）。

```sh
npx -y @yonder/connect dsh              # 安装连接器并配对这台电脑
npx -y @yonder/connect dsh --remove     # 卸载连接器并清除本机连接状态
```

它只做三件事：用 harness 自己的插件命令装入 `@yonder/dsh-connector`；用 Yonder 既有的设备码流程
打开浏览器让主人确认（`/connect?code=…`）；把设备令牌写进 `$DSH_HOME/yonder/config.json`（0600）。
不改 `PATH`、不装全局命令、不写环境变量；卸载只移除这个包、它的 bundle 条目和连接状态。

| 选项 | 说明 |
|---|---|
| `--endpoint <url>` | 云端地址，默认 `https://yonderbot.net`，也可用 `YONDER_ENDPOINT` |
| `--profile <name>` | 安装到哪个 DSH profile；默认唯一的非 `desktop` profile |
| `--spec <spec>` | 安装来源，默认 `@yonder/dsh-connector@latest`，可给本地 tarball 路径 |
| `--no-open` | 只打印确认链接，不自动打开浏览器 |
| `--interval-ms <ms>` | 等待确认时的轮询间隔，默认 2000 |

`desktop` profile 由 DeepSeek Harness 桌面应用独占，`dsh plugin` 会拒绝管理它，因此安装器不会选它。
