# 插件调试 skill

## 批准与依据

2026-10-19用户批准此前两文件方案：真实渠道短任务、现有事件/转录取证、按需隔离复现。沿用spec/03 §6的skill发现与按需读取，不新增插件或调试系统。

## 允许路径与任务

- `skills/yonder-plugin-debug/SKILL.md`：入口、取证、结果及停止条件。
- `skills/yonder-plugin-debug/references/scenarios.md`：正常链及故障/时序场景选择。
- `packages/core/src/skills/skills.test.ts`：内置技能新增后的必要发现/读取检查调整。
- `docs/function-tree.md`、`docs/plugins.md`：新增技能的必要目录项，注明未随1904安装。
- 本任务文件：批准、结果、原始失败与未测。

## 验证

验证frontmatter、实际发现/按需读取和已有skills聚焦检查；再用一条CLI真实模型只读短任务验证指导。不执行全仓矩阵、飞书发消息、故障注入、正式配置修改或发布安装。

## 结果

已创建两个skill文件，沿现有builtin发现与skill_view按需读取，无运行代码/加载机制变更。目录清单已同步，明确1904安装包尚未包含本次源码技能。

- 聚焦检查：`npx vitest run packages/core/src/skills/skills.test.ts --exclude '**/dist/**'`，1文件/5通过/0失败/0跳过。覆盖main、operator、preset的索引、正文不注入、按需正文及参考文件读取。日志`/tmp/yonder-plugin-debug-skills-test.log`。
- `npx biome check packages/core/src/skills/skills.test.ts`通过；git diff --check通过。没有执行全仓测试、构建、发布或安装。
- 真实CLI控制面调用：installed1904，preset default，session2116，真实模型`openai/gpt-6-luna`，run2124。输入`01M59NYF6SEZ01A6BPHRGEQA0F`；唯一run.end `01M59P05BKRWYJT26J562QTR2P`，inputs包含该输入，status=done，会话已自动关闭。
- 实际工具：read两次，读取本次SKILL.md与references/scenarios.md；bash四次（版本+错误status、help、service status、service info）。实际读到正式版本1904/42646a4、PID45631、ready=true。未发飞书消息，未变更配置/服务，未写业务文件。
- 提示词、完整转录及终态：`/tmp/yonder-plugin-debug-prompt.txt`、`/tmp/yonder-plugin-debug-session.json`、`/tmp/yonder-plugin-debug-run-end.json`。任务只按路径读取新skill；并非已安装版本中发现新skill，后者由源码聚焦检查覆盖。

## 问题与未测

- creator的Python quick_validate实际失败：`ModuleNotFoundError: No module named yaml`，沿用已知环境限制，未安装额外依赖；项目实际YAML解析/发现及按需读取检查通过，不能声称Python校验成功。
- 真实任务先猜了不存在的`yonder status --json`（exit2）；随后查help并用service status/info完成只读目标。保留原错误，在skill中明确service info命令及不猜子命令。
- 模型最终口头报告错误声称“没有运行preset”；实际会话mode=task/profile=default且有对应输入与run.end，故CLI控制面preset短任务成立，但不是channel-cli socket消息接入。补充入口由外部证据确认的指导，未再次调用模型检验修订，不能承诺以后模型不犯错。
- 没有跑飞书/MCP/断连/取消矩阵、结构化回执扩展或新依赖，没有推送、发行及正式安装修改；skill不等于全部插件和平台场景通过。
- 原有未跟踪`.claude/`为任务开始已存在内容，未读取、修改或纳入提交。
