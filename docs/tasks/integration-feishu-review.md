# BrowserSkill / 飞书旧分支整合审查

2026-10-19；只读基线 `504b7fc27443a7322b36b0b69c636fd91e64f01d`（1903），当前分支zoran/first-pass。范围仅zoran/completion-browser-feishu及zoran/yonder-browser。未改源码、切分支、合并、删除/归档worktree；未运行测试、模型或飞书操作。

## 结论

两分支的功能及修复均已通过整合提交进入当前HEAD，没有发现真正漏合的源码、依赖声明、许可、skill、测试或结果记录。不要再次cherry-pick全部提交或以旧树覆盖当前实现。若本次整合要求所有历史分支成为main祖先，可在主路保存当前待提交成果后做保留当前树的历史归并（ours策略），明确只是接回已审核历史，不新增功能。没有需要先搬回的漏项文件。

## ancestry与精确内容证据

| 旧分支/提交 | 原生祖先事实 | 实际整合事实 |
|---|---|---|
| zoran/yonder-browser `2d79782` | 不是504b7fc祖先；merge-base=b7f2951 | 与completion支`6cbbce9`的整个plugins/browser-skill目录及N07任务文档完全相同 |
| completion的`6cbbce9`、`695120c` | 均不是504b7fc祖先 | `695120c`与当前原生祖先`cb2b800`的整个plugins/browser-skill目录完全相同；N07仅整合提交另加4行交接文字 |
| completion的`72b67e2`、`3b0b17f`、`4d13d51`、`5291733` | 均不是504b7fc祖先 | 最终`5291733`与当前原生祖先`fa287fb`的整个plugins/channel-feishu目录完全相同；N12仅整合提交另加4行交接文字 |
| `cb2b800`、`fa287fb`、`a4e049d` | `git merge-base --is-ancestor <commit> 504b7fc`均exit0 | 属于当前历史中的真实整合/后续修复，不是推测曾经合过 |

`git cherry HEAD zoran/completion-browser-feishu`将6个旧提交全部显示为`+`；`git cherry HEAD zoran/yonder-browser`也将2d79782显示为`+`。这是单个patch-id没有对应项，并不证明实现漏合：原始多提交被汇总进入cb2b800/fa287fb。这里的“等价整合”依据是目录逐字相同，不能误称每个旧commit均有相同patch-id的cherry-pick。

已实际执行的精确检查（均diff为空/exit0）：

```sh
git diff --quiet 2d79782 6cbbce9 -- plugins/browser-skill docs/tasks/next/N07-browser.md
git diff --quiet 695120c cb2b800 -- plugins/browser-skill
git diff --quiet 5291733 fa287fb -- plugins/channel-feishu
git diff --quiet 5291733 504b7fc -- plugins/channel-feishu/src/protocol.ts
```

## 逐项源码核对与后续替代

- 695120c补的cli-missing结构化状态仍在当前 `plugins/browser-skill/src/index.ts:97`；重启加载后await sessions.cleanup仍在同文件307行。与旧支的差异是后续类型注解/格式，没有丢功能。
- 5291733补的post顶层files与嵌套post.files处理，当前protocol.ts100–110行原样保留；整个protocol.ts对旧最终分支仍完全相同。原生chat_type只接受p2p/group的校验仍在channel.ts407–414行。
- 当前BrowserSkill operations.ts改用既有typebox Check执行schema校验，保留跨字段规则；runner.ts删除不可达Windows专用15秒宽限/stdin EOF分支，保留macOS SIGINT、强杀时限及退出后有界排空。这些是原生祖先a4e049d的已记录替代（见repair-b-result.md），不是漏合旧分支；本次不能恢复旧分支的冗余实现。
- 飞书后续a4e049d已补ToolContext共同投递和uncertain事实；003d92c、8ec8d52补恢复/Typing/跨渠道交互；097fe9e、65fa4db补D36背景和真实投递正文；5c5b51b补原发送时间快于本机时钟的固定区间。旧分支没有connection.ts、history.ts、interaction.ts、conversation.ts及对应回归；直接按旧树覆盖会删除这些当前成果。
- 当前conversation.ts23行仍为 `Math.max(Date.now(), ...times)`；本次建议必须保留该1903时钟修复，以及恢复水位、原生去重、原身份/权限、工具输出uncertain、CardKit无重复发送和Typing终结清理。

## worktree状态

使用 `git -C <path> status --porcelain=v1 --untracked-files=all`，两处输出均为空：

| worktree | 实际HEAD | dirty/untracked |
|---|---|---|
| /Users/zoran/.codex/worktrees/completion-browser-feishu/yonder-harness | 529173379791ceb4e1f416ad3816fe70cd316c59 | 无 |
| /Users/zoran/.codex/worktrees/yonder-browser/yonder-harness | 2d797823faaad79cc02a76d80f79fefbd92d541f | 无 |

当前主checkout有主路正在收拢的文档、飞书README等修改，不属于上述两worktree漏项；未擅自暂存、覆盖或提交。这份审查只判断指定两个历史分支，其他工作树、PR及正式发行由主路统一整合。
