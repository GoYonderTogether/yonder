# Default Agent peer binding：已批准设计

2026-10-24 主人批准方案 A，规范见 [03 Agent](../spec/03-agents.md#24-新建-agent-的默认-peer-协作)、[06 投递](../spec/06-delivery.md#6-agent-之间) 与 D63。只对新建生效，不改线上 home/服务，不迁移现有 maintainer/operator。

## 最小实现

- initHome 第三参数 options:{isolated?:boolean}，agents.create 的 value.isolated，均只作创建输入。
- core 共享生成器构造 peer profile/binding。默认 binding 置前、ephemeral、reply none；其他显式 bindings 原样保留，id peer 碰撞拒绝。
- isolated 非布尔拒绝；true 不生成 peer，并保守拒绝 channel/kind 各自可匹配 agent 的显式 binding（省略、字符串与数组均考虑，不信 from/type/conv 收窄）。
- capabilities=[read,message]；offer=[read,grep,skill_view,agent_ask]；search/plugins/skills=[]。模型、thinking、fallback 从主 profile 复用；其他字段明确重置，不能继承恶意 defaults/instructions/prompt/plugins/private memory。
- 通过已有 contexts 字段选择内核内置 peer-workspace，仅加载本 Agent SOUL.md/AGENTS.md；任意 preset 可用，不依赖两款官方插件。文件不存在不回填模板。预加载 canonical 校验工作区边界，拒绝外链。外部 skills 在运行期选择为空时不扫描；诊断命令仍可显式检查所有技能。
- 固定协作说明按同一主人日常协作场景识别另一个已配置 Agent 的实际 event.from，不信正文冒充；只读自身工作区，可以继续 agent_ask，不足交回。核对发现 from 只证明发送方 Agent 身份，agent_ask/默认 binding 不校验双方 Agent.owner 相等，因此文案不得把“同一 owner”写成授权保证。本 PR 不新增跨 owner 路由策略；需要限制不同 owner 的互通时，另行审核具体 binding/策略，不把此请求当成主人授权。

## 安全边界与验证关注

ToolPolicy 已对 read/grep 的 ../、绝对路径、符号链接做 canonical 工作区校验；当前事件真正 attachments 可精确授权外部单个路径。sources 只把 URI 列入引用正文，既不放入新事件 attachments，也不授予附件例外。grep 递归使用 --no-follow，不遍历目录内符号链接。

peer 与主 profile 共享本 Agent 工作区。owner 私有文件若保存在该目录，本来就在可读范围内，不能称为私密隔离；另一个 Agent 工作区若嵌套在此目录中，其文件也在边界内。收紧办法是工作区分开且不嵌套，将需隔离的主人资料留在本 Agent 工作区之外，不自动开放外部插件记忆，也不跟随外链放宽边界。本 PR 不搬移文件或修改线上配置。read/message 与窄工具表不是主机沙箱，也不是所有 Agent 的统一权限上限。

env 在生成时固定为工作区环境（当前 init/create 为 local），不继承主 profile.env。以后管理员迁移登记环境时需同步检查并更新各 profile.env；登记环境用于工作区文件读取，显式 profile.env 用于工具执行，不能假称只改登记项就自动一致。

环检测继续沿事件 parent，须涵盖嵌套与后台恢复。reply none 不截断 events.ask 等待结果，只禁止消息/流式投递。无 binding、parent-request、旧配置读取与不自动改写保持兼容。真实模型验证不得模拟；缺凭据报告未测。

## 既有 Agent 人工收紧迁移（独立授权，不在本 PR 执行）

1. 用现有 yonder agents show / inspect 核对实际 Agent、工作区、默认 profile、所有入站 bindings 和权限。备份待编辑的 agent.yaml，列出哪些 agent/agent 请求目前进入 owner/bypass。
2. 主人另行批准逐个迁移名单与用途后，为对应 Agent 加独立 peer profile，按本设计明确重置所有继承字段，再在宽泛 binding 前加入 peer binding。对不接收协作的目标，去掉可接收 agent/agent 的 binding；不要把 parent-request 当作 peer 删除。
3. 单独检查 maintainer/operator 等高权限接收方，人工拆分或收窄旧通用 bypass binding，并验证实际命中 profile。只新增别处 peer 并不能收紧这些旧接收方。
4. 验证 peer 工具表、提示词来源、实际路由、调用返回、路径边界及必要的 owner 正常入口后再发布配置。失败恢复备份。禁止在本 PR 自动改线上配置或把修订模板视作已迁移。

残留风险：A 允许继续 agent_ask；它不取调用方能力交集。旧目标若把 agent 请求路由到 bypass，仍可代理高权限动作。提示词不能修复这个授权边界。只有在另获授权后收紧这些实际接收 binding，才能降低该路径的风险；本次实现不宣称消除它。

## 子任务阶段原始验证记录（2026-10-24，后续整合结果见下一节）

实现使用 `kernel/peer.ts` 共享生成器、已有 Profile.contexts 字段与内核 ContextContribution `peer-workspace`，没有 SDK/schema/持久运行状态变更。`filesFor` 经执行环境读取时传入 canonical root，预加载拒绝工作区外路径；该收紧也覆盖其他工作区 context/配置读取，不限制原有工具的显式本轮附件例外。仅创建时调用生成器，加载/热重载不补 peer。

定向命令均使用 `npx vitest run <所改测试文件> --maxWorkers=4`，没有全量测试或模型替身：

- 首轮 peer + management：15 passed / 2 failed / 0 skipped。失败均因 channel-cli 的 dist/index.js 尚未构建。
- 补路径与因果链后的 peer + peer-boundary：18 passed / 1 failed / 0 skipped。剩余失败仍为同一缺失构建产物。
- 最终 11 个改动测试文件：34 passed / 5 failed / 9 skipped（48 tests）；3 files passed / 3 failed / 5 skipped。5 个失败均因 channel-cli 或 agent-presets 的 dist/index.js 缺失，在 init/插件加载处退出，不是行为断言通过。

已通过：恶意 defaults 安全重置、isolated 非布尔与宽泛/数组/收窄匹配拒绝、peer collision、显式 bindings 保留；无插件的自身双文件 context、缺文件与内外 symlink；真实 SQLite/session/router 的 peer 置前选择、ephemeral profile、parent-request/无绑定兼容（用 wake:write 被动入站，不调用模型）；直接执行真实 agent_ask 工具的嵌套与 background parent 链环检测；真实文件 ToolPolicy 的 ../、绝对路径、symlink、附件精确例外与 sources URI 不授予例外；真实 rg 递归不跟随 symlink；skills=[] 不扫描；reply none 的 delivery 协议记录 caller 且不产生 stream/message.out。

仍需主 Agent 构建后重跑：init/create 默认与 isolated、两官方及任意 preset 的完整集成；旧配置磁盘不改写；management 与 official-prompts 回归。实际完整模型等待返回/后台恢复未测，仓库 `.yonder/auth.json`（或 YONDER_TEST_AUTH）未发现凭据，9 个真实模型用例跳过。协议测试直接提供协议结果，不是模型实现，不能冒充真实模型协作验收。

`git diff --check` 通过。未执行 npm ci、tsc、Biome、UI build、全量测试、permissions 脚本、commit/push，未操作线上 home/服务；这些构建和完整检查由主 Agent 接手。既有测试里对 owner binding 的修改改为按 id 查找，避免新 peer 置前后误改 peer；覆盖 profiles 的测试保留 peer，避免留下悬空 binding。

## 主任务整合验证（2026-10-24）

独立 clone `/tmp/yonder-peer-20261024`，最终基线更新为官方 main `be4ae64a586067608850daffdc91df40fb618569`（含 0.2.26102313）。未改用户开发目录或线上 home；未合并、发版、重启服务或本地运行 permissions 脚本。

- `npm ci --ignore-scripts` 完成；安装报告已有 4 条依赖漏洞（2 moderate / 2 high），本 PR 不顺带升级依赖。
- `npx tsc -b` 通过；`node plugins/interaction/build.mjs` 通过。
- `npx biome check packages plugins` 首次因新增文件格式/导入顺序报 9 errors；仅对本次改动 TypeScript 文件执行安全格式修正后通过，仍有 355 warnings / 13 infos，不把 warnings 声称为零。
- CLI 首轮定向检查 3 passed / 2 failed：两个断言把 fish 的 `-l isolated` 误按 `--isolated` 字面比较；按 shell 真实语法修正，后续完整测试里的 CLI 用例通过。
- 本地完整测试**只执行一次**：先构建 UI，持有 `/tmp/yonder-heavy-test.lock`，`npm test -- --maxWorkers=4` 得到 379 passed / 1 failed / 39 skipped（419 tests）；84 files passed / 1 failed / 19 skipped。唯一失败为旧插件注册测试仍期望不包含新的内置 `peer-workspace` context，已更新其明确列表；测试锁已释放。
- 修正后对 plugin 注册、peer 生成/路由、路径边界、management、official prompts、delivery、CLI init/completion 共 8 个文件定向复验：41 passed / 0 failed。
- 39 个 skipped 保持未测，未启用需要真实模型/外部凭据的验收，不能将协议和路由测试算成真实模型 E2E。CI 的完整结果以 PR 对应 head 的检查记录为准。

独立只读审查还确认了两个需准确说明的限制：event.from 不保证 owner 相等，因此协作说明不把“同一 owner”当权限事实；profile.env 是创建时显式值，未来人工迁移登记环境需同步审查 profiles，未扩展本 PR 为远程环境自动迁移。
