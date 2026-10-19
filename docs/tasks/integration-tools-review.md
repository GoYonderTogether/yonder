# 工具分支整合审查

日期：2026-10-19。比较基线固定为 `504b7fc27443a7322b36b0b69c636fd91e64f01d`；仅只读 Git 图、工作树状态和源码/历史差异，按用户新授权停止扩验收。未运行测试、模型、浏览器或外部写操作；仅新增本报告。未切换、删除、归档工作树或写产品代码。

结论：本次三个旧 head 的功能已被改写吸收且有后续修复，**没有发现尚需取入的真实功能或补丁**。不能因 `git cherry` 显示 `+` 就重放旧补丁。推荐由整合主 agent 保留现行树、创建明确记录吸收的历史 merge（如需全部旧 head 成为 main 祖先）；不要以旧分支树覆盖现行实现。报告本身没有执行 merge。

## 图关系与工作树

| 旧 head | `merge-base --is-ancestor <head> 504b7fc` | merge-base | `git cherry 504b7fc <head>` | 对应工作树 |
|---|---|---|---|---|
| zoran/completion-codex-github `50146fa` | 退出1：不是祖先 | `446ea49` | 9条均`+` | `/Users/zoran/.codex/worktrees/completion-codex-github/yonder-harness`，clean |
| zoran/yonder-codex-tools `e067930` | 退出1：不是祖先 | `b7f2951` | 1条`+` | `/Users/zoran/.codex/worktrees/yonder-codex-tools/yonder-harness`，clean |
| detached completion-web-skills `beb0abd` | 退出1：不是祖先 | `446ea49` | 4条均`+` | `/Users/zoran/.codex/worktrees/completion-web-skills/yonder-harness`，clean、仍detached |

三个工作树均再次以 `git -C <path> status --porcelain --untracked-files=all` 检查，输出为空，无tracked dirty或非忽略untracked；没有据此删工作树。主工作树有主 agent 当前文档改动，本次没有覆盖它们。

`git cherry` 按完整提交patch-id判断，无法识别“拆分/合并/改写提交但路径内容已吸收”；下面以实际子树与集成提交对比，且核实这些集成提交都是504b7fc祖先。

## 50146fa：Codex + GitHub

旧提交依次为2247a55、5328221、20b136b、e49d581、5c2291e、94aeda8、7dbed57、f8a5e39、50146fa。

- `git diff -w 50146fa 5fb51c6 -- plugins/codex-tools` 输出完全为空。5fb51c6是当前基线祖先：旧Codex插件初实现、错误分类、JS非空schema、原生搜索来源校验以及直接spawn Codex去除个人网络包装器，已完整吸收。
- 相对旧head，当前Codex生产源码差异仅为后续e679aeb的run生命周期说明/status lifetime，另有新增真实协议边界与清理检查及版本变化；旧app-server/search代码没有缺失。当前 `app-server.ts:40` 保留 `spawn(codex, ["app-server"])`，不是回到个人agent-network依赖。
- `git diff -w 50146fa 9d86a5b -- plugins/channel-github` 唯一差异是README维护模型从默认Luna改为已批准Sol的说明，生产源码完全相同。9d86a5b为当前基线祖先。因此旧issue轮询、PR工具、Release源、独立更新job、原生updated_at水位、取消参数公开类型、去个人网络包装器已吸收。
- 现行GitHub后续有实质修复，不能倒退：6ebfcea将评论走 `api.messages.send` 共同投递、报告写入结果不确定性、Release首次baseline/落盘确认、更新前后核实运行控制面的ready/home/PID/version/commit，以及启动失败清理；690d399修首次扫描不传1970 since。源码分别见 `src/index.ts:95`、`channel.ts:121`、`update-job.ts:65`及`releases.ts`/`updates.ts`。
- N06/N10/N11历史任务文件当前仍存在且已有后续结果；没有需要从旧分支恢复的独有任务文件。

建议：以“旧功能已由5fb51c6/9d86a5b吸收，现行后续修复优先”记录历史merge，保留当前树；不再次普通cherry-pick九条旧提交，不取旧GitHub或Codex目录。

## e067930：早期 Codex

- 此head仅一条未在当前图中的提交；`git diff -w e067930 2247a55 -- plugins/codex-tools` 输出为空，说明它与completion-codex-github早期2247a55插件子树等价。后者的最终插件子树又与当前祖先5fb51c6完全一致，形成可核对的完整吸收链。
- 旧e067930仍直接依赖个人agent-network包装器，且缺5328221后补的错误分类/原生搜索HTTP(S)来源校验。当前版本包含后续修复与本轮run边界说明，不存在要复原的独有执行功能。
- 对应N06结果在当前任务文档已延续；不为早期阶段记录覆盖后续事实。

建议：保留当前树并记录此旧head已被等价实现及后续改进吸收；如需图收口，历史merge该head。不得取该head恢复包装器或旧搜索逻辑。

## beb0abd：Web + Skills

旧提交为d6fd2a6（Web）、34f0971（Skills）、855ba5c（JS外壳诊断）、beb0abd（工具清单全名修正）。

- `git diff -w beb0abd d55101e -- plugins/web-tools` 仅package.json的files多打包README/SOURCES，其他文件一致。d55101e为当前祖先，因此Tavily Search/Extract、Fetch/Readability、JS外壳诊断、三工具实际全名均已吸收。
- 现行Web还包含2e8307f的共享TypeBox输入检查、预取消检查、非空白参数约束及后续e679aeb的提取边界说明；package.json保留 `web-tools_search/extract/fetch` 全名并升级到当前统一版本。不能取旧144行实现来绕过现有输入检查。
- 34f0971的所有Skills生产变化已核对存在：`parseSkillFrontmatter`公开、pluginSources目录→插件ID映射、复用readSkill、管理show返回胜出/遮蔽/正文、addLocalSkill/removeLocalSkill导出及实现。当前 `packages/core/src/skills/index.ts:53/100/139/249/272`、`manage.ts:29/56`均可对应原变化；集成祖先24229e4已含这些API。
- 现行2e8307f专门修了旧Skills导入：旧先mkdir目标后对整来源cp，在errorOnExist下会撞已创建目录；当前 `manage.ts:42`逐项复制到独占目标目录，保留拒覆盖、资源/链接校验与失败清理。65fa4db追加内置skills来源，原pluginSources/show/管理能力仍保留。旧分支无现行缺失功能，不能用旧manage.ts覆盖这个真实修复。
- `docs/tasks/completion-c-web-skills.md` 在当前树存在，内容已保留原本“实现未验收”和旧检查/缺依赖的阶段事实；对旧head比较无差异。N08任务文件有后续结果，不需要复原旧状态。

建议：保留现行树、明确记录四条旧提交的功能由d55101e/24229e4吸收且已被后续修复推进。detached head若需图收口可用其完整hash作为历史merge parent，不能仅因无分支名而遗漏；本报告没有建立/移动该引用。

## 整合操作边界

本报告支持保留当前源码树的吸收merge，并不能将未通过的真实上传权限、Browser断开恢复、CUA菜单或飞书平台验收改写成通过。用户已要求停止扩验收，故本次不重开这些链。正式main/Release及其他分支/PR归整合主 agent；清理工作树前仍由其完成授权内的最终状态与保留处理。
