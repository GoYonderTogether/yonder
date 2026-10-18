# 下一阶段实施任务

**当前工位：暂停后续 N 派工，先等 U05 和新计划审核。** 2026-10-18 最新要求见 [能力补齐计划](../capability-completion-plan.md)、[Hermes 对比](../hermes-capability-comparison.md)、[13 草案](../../spec/13-capability-completion.md)。拟改为多路 sub agent 的实现轮，不新增或运行测试；尚未放行。以下保留原 N 需求、依赖与结果，不能用新编号清掉历史失败或跳过。

原 N 轮于 2026-10-18 获批，功能以 [10](../../spec/10-local-maintenance.md)、[11](../../spec/11-official-plugins.md) 为准。新计划只调整后续编排；原功能与最终验收继续保留。

参考更新和本机只读状态见 [reference-sources.md](reference-sources.md)。它记录证据，不新增需求。

## 原任务清单（新编排待审，非当前派工指令）

- 🟢 [N00](N00-contracts.md) 设计锁定与旧规范对齐｜Codex｜无依赖。
- 🟢 [N01](N01-runtime-foundation.md) 基础边界已实现并检查；恢复/输入组合缺口挂 N05/N09｜Codex｜N00。
- 🟢 [N02](N02-mcp.md) MCP 已实现，开发版真实 Luna 检查通过，安装版复验挂 N03｜Codex｜N01。
- 🟢 [N03](N03-install-agents.md) 独立安装、阶段更新、常驻服务、Luna/Sol 与两个真实 agent 已验证｜Codex｜N02。
- 🟢 [N04](N04-first-repair.md) Luna 首个自主修复已提交、整合、安装及真实转换复验｜Yonder，Codex 审查｜N03。
- 🟡 [N05](N05-recovery.md) 部分实现未提交，旧工作树已暂停；D29 已批准，待在 TUI 新基线上逐项移植｜Yonder 已写，Codex 负责整合｜原依赖 N04。
- 🟡 [N06](N06-codex-tools.md) 插件源码已提交 e067930，尚未整合/安装；不算安装版桌面或搜索通过｜Yonder｜原依赖 N03。
- 🟡 [N07](N07-browser.md) 插件源码已提交 2d79782，尚未整合/安装；扩展连接仍阻塞真实页面验收｜Yonder｜原依赖 N03。
- ⚪ [N08](N08-coding-web.md) grep/Bash、Tavily、Web Fetch｜Yonder｜N03；不依赖 hosted search 或浏览器。
- ⚪ [N09](N09-sol-tests.md) Sol 已真实可用；补测试留后轮，已知源码缺陷拟归 C1/C3｜原验收保留｜不再作为新计划中 N10/N12 源码开发的测试门槛；待批准。
- ⚪ [N10](N10-github.md) issue→设计→commit→PR→Codex 合并｜Yonder｜N09。
- ⚪ [N11](N11-release-update.md) 发布事件与 operator 安装更新｜Yonder｜N10。
- ⚪ [N12](N12-feishu.md) 飞书完整渠道开发｜Yonder｜N09；不等 GitHub 发布链。
- ⚪ [N13](N13-feishu-live.md) Computer Use 验证真实飞书矩阵｜Yonder 执行，Codex 观察｜N12、N06 桌面能力、已安装飞书包与真实授权。
- ⚪ [N14](N14-acceptance.md) 整条自维护链与全部剩余验收｜Yonder + Codex｜N01–N13 各能力验收；任何未通过项保留。

## 原执行与检查规则（本轮实现方式调整待审核）

1. 用户已授权本轮实施。N00 先统一新旧规范并记录冻结 commit，随后按依赖连续推进；不重复请求整轮或普通任务批准。后续实现者不能修改功能规范。
2. 每项读取其功能依据、现有源码、相关调用者与失败路径，再实现；涉及参考项目时记录固定 commit/模块。
3. Codex 经 MCP 下发允许路径和验收；Yonder 的事件、会话、转录、模型、diff、commit、PR 形成任务证据。没有这条证据链的部分归实际执行者。
4. 不同包的独立阅读与检查可并行；跨 SDK/core 或同路径修改顺序执行。默认不另开 Codex 子 agent 实现任务。
5. 相关检查通过后结束该任务；N09 实现并执行当前已具备条件的全部原验收，缺未来能力的项目明确挂接 N11/N13/N14。N14 执行剩余与跨能力整体验收，不重复无变化且无疑点的检查。
6. 发现问题立即写当前任务“问题”；实现缺陷按冻结契约修，设计变更交用户审核。Yonder 阻塞由 Codex 介入，并如实记录。
7. 一个任务一个提交边界；涉及旧 T 任务修复时保持按原领域拆提交。当前 PR 由 Codex 审核合并，发布/更新按已批任务范围执行。

## 前置试通与阶段安装

- N00 使用已有入口对 Computer Use、hosted search、Sol 做最小可逆探测，证据分别记 N06/N09；缺授权列具体阻塞，继续 N01。后端选择按 11 §3，未调用成功不记选定。N03 在安装版 Yonder 内验证实际 provider/model ID，N06 完成桌面/搜索的 Yonder 工具链验收。
- N03 由 Codex 实现并验证 10 §2.1 的首次和阶段安装；N04/N05 的核心修复及 N06–N13 的插件在被后续任务使用前，安装切换与真实调用证据随任务交付。自动更新未接通时由 Codex 从服务外部执行，不等待 N11，也不由正在被替换的任务更新自身。
- 阶段安装共用允许路径：已批准的安装/home/本项目 launchd 配置；发行元数据限根及 workspace 包的 version、相应锁文件与 CHANGELOG。由 Codex 单独管理发行提交和本地标签，不扩展各任务业务源码范围；安装器缺陷回 N03/N11 的路径处理。
- 更新后确认安装包含新增插件、批准配置已生效，保留 executable/version/commit/home/pid 和一次 MCP 调用证据。不同源码不得复用同一安装版本。N11 正式发布由 Codex 创建 GitHub Release，operator 接手更新后仍执行同样核对。
- N05 写代码前，Codex 在该任务结果中记录运行事实来源、关联持久化、配置快照、终结/投递负责点及拟删除状态，再让 Yonder 实现；规约内技术方案不增加用户审批轮。

## 任务记录格式

每项已列负责人、依赖、规范、允许路径和验证入口。实现结束追加：变化、实际命令/结果、event/session/model/commit/PR、未完成项。原始失败和跳过计数不删除。

## 2026-10-18 进度核查与 Sol 并行派工

用户已批准开发使用 `openai/gpt-6.1-sol`。安装版 maintainer 默认模型已改为 Sol，保留 main 聊天 Luna；`config.reload` 事件 `01M57MDKP74RM6S54VWK3X4FSC` 确认校验成功。doctor ok；真实服务仍在独立安装目录运行，核查时版本 0.1.4、pid 11455。

### 实际慢点（America/Caracas）

- N04 两次只读方案分别约 115 秒、66 秒；第一次遗漏准确参考 checkout/依赖路径，Codex 补齐后继续。实现约 238 秒，已经产生真实修复 commit `13ea8d4` 并安装。
- N04 安装版检查分别约 41 秒、53 秒；首次故障注入假设有误（pi 忽略 section 渲染异常），保留失败，第二次只重跑未通过场景，以必需配置解析失败验证真实 faulted。不是反复重做已通过功能。
- N05 第一次只读核对 09:02:18–09:09:54，约 456 秒；关联检查任务 09:18:21–09:29:27，约 666 秒，真实 Luna 检查本身约 24 秒。任务阅读、生成/修正检查和编译占其余部分；不能把总耗时都归为模型调用。
- N05 09:29 已完成后，Codex 未及时接续派工，至 09:47 核实前约 18 分钟没有新增开发产出。期间宿主探测不等于产品实现；该延迟归 Codex 调度。此前也未使用 N06/N07 的独立并行条件。
- 同步 MCP 客户端曾因 HTTP headers 超时退出，但原生任务继续并完成；已通过事件/转录找回，没有重发。长任务现用 `events_emit` 接纳后查原生结果，不新造任务状态机。

### 当前三个原生会话

同一真实 maintainer 的三个独立持久会话，各自独立工作树，不是新建 Codex 子 agent。此次证明会话并行；不把它冒充 `task_run` 父子并行的完整验收。

- **N05 / session 35 / Sol**：`zoran/yonder-maintainer`；MCP 输入 `01M57MHT1E7J7QJNH0KGFHHVJC`。交接 Luna 已通过证据，只补非成功无 answer 的恢复分组和 successor 快照边界；暂限检查与任务文档，待 Codex 审查最终改法。
- **N06 / session 510 / Sol**：`zoran/yonder-codex-tools`；输入 `01M57MJ2Z1RA08GR92ASB5PWNH`。只负责 `plugins/codex-tools/` 与 N06 任务，复用已验证 app-server 桌面和受限 hosted search 连接，先完成具体方案供 Codex 审查。
- **N07 / session 526 / Sol**：`zoran/yonder-browser`；输入 `01M57MJAK04VHDQDJZ1P0Q2T3P`。只负责 `plugins/browser-skill/` 与 N07 任务，复用 bsk 与上游适配，先完成具体方案供 Codex 审查。

13:52:29Z 与 13:52:37Z 分别接纳 N06/N07；之后两会话转录均有实际工具结果且原生 entry ID 交错，确认并行运行。最终模型身份与检查结论仍以各自 run.end/转录为准。公共 workspace、锁文件、版权记录、阶段安装由 Codex 依次整合，运行中的服务不被开发会话更新。

### 已测与未测

N03 已验证独立安装/登录、真实 Luna/Sol 工具调用、服务重启后续聊、明确 abort、CLI 输入与流式回复。N04 已验证共享结果转换及真实 done/error/limit/aborted；N05 原生检查 1 test passed，但产品恢复链未完成。N06 宿主应用清单与 native hosted search 已成功；N07 宿主 doctor 8/8、Agent Window 导航/观察/释放已成功。这些宿主结果不计作 Yonder 插件完成。N08、N09 全量验收、GitHub、发布更新和飞书真实矩阵仍待实施。

### 可用 CLI 与当前限制

```sh
export PATH="$HOME/.yonder-harness/bin:$PATH"
export YONDER_HOME="$HOME/.local/share/yonder-harness/home"
yonder version --json
yonder service status --json
yonder doctor --json
yonder chat
yonder sessions list --agent maintainer --open --json
yonder sessions show 35 --json
yonder sessions show 510 --json
yonder sessions show 526 --json
yonder events --type message.in --conv conv:control:maintainer-n06 --limit 20 --json
yonder events --type run.end --from agent:maintainer --limit 100 --json
```

以上 PATH 只影响当前终端，不改用户 shell 配置。`sessions show` 返回会话及默认一页原生转录（最多 100 条），不是完整长历史；MCP `sessions_transcript` 支持 `from` 原生 entry ID/`limit` 分页。CLI `chat` 当前进入 main，不支持 `--agent` 或继续指定 session；维护输入使用 MCP conversation 绑定。无 CLI task status 或历史翻页命令，不虚构。显式 `yonder sessions abort <id> --json` 会真正中止该会话，不能用来查看进度。

### 并行方案结果与 N05 解阻

- N06 方案 13:57:29Z 完成，N07 方案 13:58:06Z 完成；两条原生 run.end 均为 done、实际模型 `openai/gpt-6.1-sol`。Codex 已阅读完整方案并收敛额外策略框架、模型门禁与个人路径；13:59 分别放行两个插件的产品实现，仍使用原会话510/526。hosted search沿用已验证Luna，与开发模型Sol分开。
- N05 Sol 新真实场景 1 passed / 1 skipped（旧场景有意未重跑），发现失败终结后的原生回执缺口。用户随后明确批准最小原生回执；设计先提交 `29bc8ec`（D29、07、10），再放行会话35实现。当前不再因这一设计决定等待用户；全部三条线已进入产品实现。源码、安装版及真实验收仍分别记结果。
