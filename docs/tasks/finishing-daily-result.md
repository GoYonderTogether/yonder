# P2 日用入口、CLI/TUI 与内置技能核对结果

日期：2026-10-19。范围：P2既有能力检查及P4 E06/E07证据只读核对。未改生产home、安装、配置、服务或OAuth；未提交。

## P2 结果

- **生产只读状态**：`yonder version --json` 返回0.1.2026101902、源码commit `65fa4dba6395017db21940eacaa64d6ce1c91552`；`yonder service info --json` 返回同版本/commit、正式home、PID 19108、`ready=true`。`yonder inspect --json` 显示main/owner使用 `openai/gpt-6-luna`，内置 `skill-creator`、`yonder-development` 已选；检查只读取配置/状态，没有显示凭据值。
- **CLI离线检查**：`./node_modules/.bin/vitest run packages/cli/src --exclude '**/dist/**'`，4个文件通过、9项通过、0失败、0跳过。覆盖命令、TUI渲染/输入补全及bash/zsh脚本装载；此前U04记录的原始全套结果（22文件中19通过/3跳过，32项中27通过/5跳过）保留，不能与本次聚焦结果合并为全量通过。
- **真实PTY**：用隔离home `/tmp/ytui-live-H31ffU` 的既有Luna配置和 `credentials` 文件路径引用仓库既有授权，未复制OAuth。前台独立进程报告1902、ready后，`record-terminal.py --mode yonder` 退出码0；实际Luna工具调用和同一manual task续聊完成，Ctrl+C对应真实 `run.end.status=aborted`，会话仍开放。客户端退出后，`--mode presentation --session 187` 再进入并恢复历史，退出码0。两次运行均保存实际PTY记录于 `/tmp/yonder-p2-terminal/`。服务随后由 `yonder stop --home /tmp/ytui-live-H31ffU` 停止，控制socket消失；正式PID未触碰。
- **补全**：测试中bash/zsh生成脚本可加载；对隔离服务执行动态bash候选查询，实际返回9个会话、`default`预设和`cli`渠道。此机没有fish可执行文件，fish实际加载未测。
- **首次初始化与OAuth边界**：在全新无凭据目录 `/tmp/yonder-p2-new-home` 执行 `yonder init` 成功；`doctor --json` 为`ok=true`、0错误、1条既有exec能力警告。该home没有启动服务，也没有OAuth；`service info` 按预期因控制socket不存在而失败。首次隔离home初始化已实测，浏览器OAuth授权互动未测。未注销、登出、复制生产OAuth或模拟登录过期。
- **skill-creator依赖**：creator三个Python辅助脚本读写YAML；系统Python运行`quick_validate.py`得到`ModuleNotFoundError: No module named 'yaml'`。这是作者工具的可选PyYAML依赖，不是Yonder运行时或技能发现/加载依赖。仅在skill说明中补充Python 3/PyYAML前置条件，未新增产品依赖。Ruby YAML对skill frontmatter校验通过。

PTY服务冷启动还输出多条旧验收home中的“历史 submission 无原生回执……不重新执行”告警；服务仍ready，本次新请求成功。该临时home的stdout未持久保存，告警总数无法独立复核；不把旧条目归为本次新请求失败，也不覆盖其历史状态。

## P4 E06/E07 只读核对

- **E06成功链已有完整记录**：issue #1 → 原生输入事件 → maintainer/Sol session与run → commit `f9df5e0` → PR #2 → Codex审阅并合入 `zoran/first-pass`，issue关闭。合并未进入main；GitHub `statusCheckRollup`为空，不能称CI通过。现有记录只证明成功维修路径，没有独立的取消/失败回执场景。
- **E07成功链已有完整记录**：正式Release `v0.1.2026101805` → release-updater/operator → 更新结果`verified=true` → 实际安装版本/commit/home核对 → 通知事件及飞书客户端可见。1902是安装源码tag，不是正式Release；已有更新证据对应1805，不能外推为1902已发布。现有记录没有更新取消/失败路径证据。本次未查询GitHub或操作Release/更新服务。
- 没有适合当前真实需求的插件开发任务；依P4边界不创建占位插件，也不重复issue #1或已完成Release更新链。开发闭环尚无新的独立证据。

## 未测与平台限制

未测首次真实OAuth互动/登录过期后重新登录、系统注销再登录、自启动、fish加载及更新取消/失败；这些都不由PTY退出/重连、init成功或历史Release更新代替。没有执行全仓测试/build/lint，也没有触碰正式安装或主服务。

## 代码变化

仅在 `skills/skill-creator/SKILL.md` 说明Python/YAML辅助脚本的可选依赖；没有CLI源代码或测试改动。结果文档为本文件；没有Git提交。
