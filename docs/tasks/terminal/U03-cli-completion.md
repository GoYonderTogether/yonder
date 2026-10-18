# U03 系统命令与 shell 补全

**依据**：docs/spec/12-terminal-interaction.md 及其关联 02/03/06–09；D30。

**依赖**：U01 U02。

**允许路径**：packages/cli/、packages/core/src/kernel/（init default）、README.md、README.zh-CN.md、docs/tasks/terminal/、CHANGELOG.md。

**必须**：实现已批准入口、plain/JSONL、sessions open/submit、completion zsh/bash/fish、双语说明与人类输出；不改 shell 配置或日用安装。

**验证**：定向 CLI 用法/JSON/退出码检查；三种 shell 可用时验证实际加载/候选，缺 shell 明确记录。

## 问题

暂无。

## 结果

已实现，U04 整体验收待完成。裸入口/TTY 使用原生 TUI；plain/JSONL 保留行客户端；默认独立任务与 --session/--channel 显式目标；新增 sessions open/submit 与 zsh/bash/fish 补全脚本。动态候选通过已有 completion <shell> --json 的单个 {script,candidates} 返回，不增加用户命令、不写 shell 配置。

验证：构建通过；2 test files / 3 tests passed，zsh 与 bash 实际加载并给出 command/subcommand 候选；隔离服务动态候选 sessions=[2]、presets=[default]、channels=[cli]。实际 plain 模式续聊收到 Luna 回复并退出。首轮 plain readline 在订阅建立期间可能丢失首行，已提前创建迭代器并延迟到首条消息才创建任务；首次修改引入 IteratorResult 类型错误，已修复。fish 本机未安装，脚本生成但实际加载未测。
