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

## 后续发行批准（2026-10-19）

用户明确批准合入main、推送、正式发布和本机正式更新，沿既有更新流程，不跑全功能矩阵。允许路径追加：workspace的package.json及package-lock.json、CHANGELOG.md和本任务发行结果。版本1905；保留上方创建阶段未安装/未发布的历史。本机main的defaults.skills为明确白名单，更新后追加新skill并保留其余配置；这是用户要求正式版直接可用所必需的配置接线。

1905构建和typecheck通过；复用前次5项skills聚焦检查及真实Luna短任务，不运行全仓矩阵。发行与本机更新回执待写入。

## 1905正式发行与本机结果

- main功能发行提交`866717730180c1cffdc016870d2605b8233f9add`已推送，固定标签`v0.1.2026101905`；[正式Release](https://github.com/zoran-xc/yonder-harness/releases/tag/v0.1.2026101905)已发布。
- 沿既有Release→operator→独立launchd作业更新，无额外手动安装：Release事件`01M59S4AG81FFAHSW8F4W4QKEW`、releaseId417132621；更新终结`01M59S68J6SJJHVPPRZ7MVW9WR`，verified=true，结束2026-10-19T09:51:19.846Z。
- 正式服务1905/8667177、PID73818、ready=true，home保持原值；程序来自`~/.yonder-harness/versions/0.1.2026101905`。未使用开发目录运行。
- main.defaults.skills只追加yonder-plugin-debug，其他字段解析对比不变；原配置保存在正式home的`.yonder/backups/main-agent.pre-debug1905.yaml`，未提交用户配置。
- 安装版`yonder skills --agent main --json`列出browser-skill、skill-creator、yonder-development、yonder-plugin-debug，均selected/indexed=true，issues=[]。安装版show能读取正文。
- 最小真实Luna运行：session2188/run2196，输入`01M59S6WMGMZP5TKABA8AQXQ55`，唯一实际工具`skill_view({name: "yonder-plugin-debug"})`；结果目录为1905安装版本目录，source=builtin。唯一终结`01M59S74N9ANPN27PS440X2V0M`，status=done，会话自动关闭。没有读取开发目录、Bash、写文件或外部消息。
- 原始记录：`/tmp/yonder-1905-build.log`、`/tmp/yonder-1905-typecheck.log`、`/tmp/yonder-1905-installed-skill.json`、`/tmp/yonder-1905-skill-runtime-request.json`、`/tmp/yonder-1905-skill-runtime-session.json`、`/tmp/yonder-1905-skill-runtime-end.json`。只做本次必要构建/类型检查/发现及一次真实技能读取，不重跑全功能矩阵。

飞书先发送`/skills`查看，再用自然语言要求“使用yonder-plugin-debug，先只读检查飞书插件状态，列出实际工具名和证据；不要修改配置或发额外消息”。没有新增`/yonder-plugin-debug`斜杠命令。该调用文案可供用户使用，本次未代用户发送飞书消息。
