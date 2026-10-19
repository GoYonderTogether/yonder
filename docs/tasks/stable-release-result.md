# 稳定版整合与发行记录

日期：2026-10-19。用户批准将本项目全部分支、工作树及PR统一进入main并正式发行。停止扩大验收，不新增功能或插件。

## 收口依据

- 发行功能基线为1903 / `504b7fc27443a7322b36b0b69c636fd91e64f01d`，P轮原始失败和未测见[结果](finishing-result.md)。
- 145项检查通过（35文件、0失败、0跳过），build/typecheck通过。全仓lint的7项错误来自忽略目录bp，产品目录0错误；不以排除报错伪造全仓通过。
- 用户明确跳过视频播放、真实断网及执行中发送插话，留给实际使用反馈。其他未测不改为通过。
- [全量功能树](../function-tree.md)列出8插件、4渠道、27插件模型工具及最小接口用途；注册存在不等于全部实际场景通过。

## 分支与工作树收口

- main原为`57a04acf`，现行成果位于zoran/first-pass；main可快进接入。
- GitHub没有打开的PR。PR #2此前已合入first-pass，其成果本次进入main；不重复创建PR。
- completion-browser-feishu `5291733`、yonder-browser `2d79782` 已由cb2b800/fa287fb吸收；见[逐项审查](integration-feishu-review.md)。
- completion-codex-github `50146fa`、yonder-codex-tools `e067930`、detached completion-web-skills `beb0abd` 已由5fb51c6/9d86a5b/d55101e/24229e4吸收；见[逐项审查](integration-tools-review.md)。
- r5-feishu-errors本地`8fe6435`及远端`f9df5e0`均已是现行祖先，无遗漏修复。
- yonder-maintainer旧N05草稿的16个文件（含3个未跟踪探针）已完整提交为`b502409a90cc5cab7b7a40f62c1f0b43572e102f`，原始实现不丢弃。其pi回执补丁与现行文件hash相同；会话busy/waiting/runId/事件和恢复逻辑由24229e4/1503f7e及8fe6435接替。旧草稿会无条件关闭任务，不能覆盖现行manual任务契约。草稿作为历史保存，不作为现行功能取回。
- 上述五个旧插件head及旧草稿采用保留现行树的历史归并；这是接回已审核吸收的历史关系，不是将旧源码重新覆盖。分支名删除不删除commit或历史。
- 清理前创建仓库外完整Git bundle并验证；管理工作树归档保留恢复快照，临时R5工作树仅在clean且祖先确认后移除。

## 发行执行结果

- 历史归并提交：`0abeb7caaaa53f32d27b0d161080174fc6754b79`；归并前后Git tree完全相同，全部旧head已成为main祖先。
- 完整备份：`/Users/zoran/.local/share/yonder-harness/archives/git-20261019-pre-main.bundle`，Git verify确认完整历史且可用，权限0600。
- 六个Codex管理工作树已归档；其最后head均已接入main。临时R5工作树已clean移除，当前只保留主checkout；本地任务分支及远端两个任务分支均已删除；main已推送。PR无待合并项。
- 本次统一版本：`0.1.2026101904`。产品功能与1903相同，仅版本、文档及历史收口；复用145项功能检查，不重跑相同矩阵。
- 1904发行构建与typecheck通过，日志：`/tmp/yonder-1904-build.log`、`/tmp/yonder-1904-typecheck.log`。功能检查复用同实现1903的145/145结果。
- main发行提交：`42646a426825317b37d5e9df88504c03da6cee65`，不可变标签`v0.1.2026101904`。
- [GitHub正式Release](https://github.com/zoran-xc/yonder-harness/releases/tag/v0.1.2026101904)于2026-10-19T07:10:03Z发布，draft=false、prerelease=false。
- 管理agent接收Release事件`01M59FYQSW6W0A247PD9HQ1078`，独立launchd更新作业417001090执行，结束于`2026-10-19T07:11:04.147Z`；主路没有另发手动更新。
- 更新终结事件`01M59G0SKY2HJXG0KH67W4NTF6`，status=verified、verified=true；本机current指向`/Users/zoran/.yonder-harness/versions/0.1.2026101904`。
- 实际服务版本1904、commit=42646a426825317b37d5e9df88504c03da6cee65、PID45631、ready=true；数据home保持`/Users/zoran/.local/share/yonder-harness/home`。按进程实际argv确认同home只有一个node后台。
- 固定更新回执：`/Users/zoran/.local/share/yonder-harness/home/.yonder/plugins/channel-github/github-project.updates/417001090/result.json`。源码目录没有作为正式运行目录；旧版本与用户历史保留。

## 交付状态

本轮main整合、正式Release与独立自动更新已完成。GitHub只有main、无打开PR，本地只保留主checkout/main。无需为相同实现重新跑测试或飞书矩阵，后续按实际反馈处理。该状态不把历史未测、平台限制及用户主动跳过项改成通过。
