---
name: yonder-development
description: Help develop or modify plugins for an installed Yonder Harness, including choosing an isolated development home, using the existing SDK and tools, and saving plugin work with Git.
---

# Yonder 插件开发

用户要新建或修改 Yonder 插件时，先用 `yonder version` 和 `yonder inspect` 确认实际安装版本与 home；不要猜 `<home>` 的绝对路径。查接口时优先使用 `yonder docs`、`yonder inspect`、`yonder skills` 和已安装 SDK。

默认把插件源码放在 `<home>/development/<name>`，也可按用户指定目录。正式版本位于安装目录 `current`（指向 `versions/<version>`），该目录没有 Git 仓库，只通过 `yonder update` 更新；不要在那里改源码。

普通用户插件保存在独立 Git 仓库，用原生 Git 记录改动。需要改官方内核或官方插件时，在主仓库使用 fork/clone、分支和 PR 的常规协作方式；先检查 remote。没有配置 remote 时如实说明，不擅自 push，也不强制云端托管或 PR。

运行和验证使用隔离的 home、端口、socket 与凭据；需要模型登录时为开发 home 独立登录；插件凭据按其实际授权方式配置。开发服务以前台手动进程运行，不用 `service install` 替换正式 launchd 服务。真实接线验证完成后，可以建议用户把插件加载到正式 home；不要把尚未运行的检查描述为通过，也不要自动发布。

用户可选择其他源码目录、Git 方式或运行方式。只完成当前请求需要的插件代码与验证，不额外搭建命令、插件框架或脚手架系统。

技能创作参考本仓库 `skills/skill-creator/`：它来自 Codex 内置技能，保留资源与许可，仅将默认技能保存位置适配为 Yonder home。
