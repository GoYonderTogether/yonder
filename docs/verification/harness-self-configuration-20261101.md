# Harness 自配置闭环：实施与验证

方案：[行为契约与分工](../research/harness-self-configuration-20261101.md)。日期按本聊天 America/Caracas；源版本 main `f92dfe0e`（0.3.26110110），本机正式安装调查时仍为 0.3.26103105，两者不能混为同一运行环境。

## 验收结论的适用范围（主人后续纠正）

下文原始 1/1 真实 Luna 记录属于**指导式操作验收**：user message 给过 CLI、文件位置及操作要求。它证明该工具/配置/重载链能执行，不足以证明真实飞书/QQ口语下 Agent 会自主找到方法。主人要求新增自然需求验收，操作知识必须由通用 harness 系统/工具/随包文档提供，user message 只用原话或明确标注的同风格改写。后续结果在本页末尾独立记录，不覆盖原始失败和当时结论。

## 范围

共享 main 实施；主 Agent 只改规范、提示词与文档，执行由子 Agent 完成，用户进一步指定 Luna 后由 Luna 接续。没有修改正式 home、安装目录或服务；没有推送触发自动发布。

## 原始验证记录（保留失败）

| 阶段 | 实际结果 | 说明 |
|---|---|---|
| C 运行事实/附件，01f3d91 | 6 个定向套件，20 通过 | 原生 section 装配、配置首选与请求模型、真实本机附件文件和跨会话拒绝；确定性测试，不是模型行为验收 |
| C 静态 | 层级、文件规模、diff 检查通过；Biome 0 errors | 保留既有 runtime/prompt.test.ts 未用 import 警告 |
| A 候选路由校验，aab5112 | 8 通过；core tsc 通过 | 仅该提交定向范围，不代表后续集成已通过 |
| B 改前 | 18/18 通过 | 授权与委派定向基线 |
| B 首次集成 | 17 通过 / 1 失败 | C 新增 offeredTools 查询，parent-origin 旧测试装配器抛 No runtime needed；后续修复与复测另记，不覆盖此次失败 |

| B 最终定向，4ea9f9b | 3 个文件，18/18 通过 | 旧 QQ 批次双 owner、直接/parent/续办、混批、伪造/跨会话/64 跳/环、可选覆盖门禁与 parent_ask isError |
| B 并发类型检查两次 | 均失败 | 第一次 A 在途代码 ownerInput 注入位置及 home.ts 构造 YEvent 缺字段；第二次仅 home.ts 缺字段。不是最终集成结论，保留失败 |
| B 静态 | Biome exit 0、diff 检查通过 | 保留 9 个既有 warning |

| social，f184d9a | 4/4 通过，typecheck 通过 | 真实存储来源解析、无需口令应用、拒绝访客/混批、revision 冲突与历史/预测诊断；不是外部平台验证 |
| social 静态 | Biome 无错误 | 保留 4 条既有 non-null 警告；kernel/index.ts 保持 500 行 |

| A 完整配置链，863dc3f / 33dca75 | 6 个文件，19/19 通过；typecheck 通过 | profile 定位、锁内文件版本核对、reload 条件恢复、精确 key 会话保护和无关插件兼容 |
| A 定向早期一轮 | 17/18 | 既有会话 kind 可确定性检查实现未完成；补同形绑定与精确 key 的证明后通过，不通过删断言收口 |
| 首次全量 npm test | 459 文件通过 / 64 跳过 / 1 失败；2489 用例通过 / 105 跳过 / 1 失败 | 自定义参与插件与 DM 的会话重叠判断误拒绝，plugins/social/test/group-delivery.test.ts；按本轮兼容回归修复，后续复测单列 |

| 自定义参与插件兼容，cca82d0 | 2 个文件，13/13 通过 | 共享 sameSession 按实际所选插件/策略推导 kind；原群投递与隔离断言保留 |
| 发布后报错恢复，590c023 | 1 个文件，1/1 通过 | 模拟候选已发布后 reload 回执报错，文件恢复后同步 reload 旧有效状态；恢复失败明确报告；不是模型模拟 |
| 全仓 build / typecheck 首轮 | exit 0 / exit 0 | 源码/构建验证，不代表运行中的服务更新 |
| 全仓 lint 首轮 | exit 0 | 1526 文件；1190 warning / 33 info，规模和层级检查通过 |
| 真实 Luna 自配置首轮 | 1 失败 | 180.4 秒没有取得匹配 run.end，不能证明模型完成配置。使用真实项目测试凭据、临时 home 和真实 CLI/control；未使用模拟模型，后续诊断重跑单列 |

| 最终全量 npm test（含 cca82d0 / 590c023） | 460 文件通过 / 64 跳过 / 0 失败；2491 用例通过 / 105 跳过 / 0 失败 | 60.88 秒；默认测试未调用模型，真实模型单独记录 |
| 最终构建 | build-final.log，exit 0 | 重新构建并校验 dist，避免新内核配旧 CLI |
| 最终 lint | lint-final.log，exit 0 | 文件规模与层级检查通过，警告/信息保留 |
| 真实 Luna 诊断重跑 | 失败 | 约 32 秒 run.end=done、model=openai/gpt-6-luna，但未生成候选文件，未完成 validate/update 或目标 profile 运行。只证明运行结束，不证明任务完成；该次最终文本/工具结果未在临时目录清理前保留 |

| 真实 Luna 取证运行 | 测试失败，但取证证明发生 9 次 bash 调用 | owner/exec/bash offer 已核对；模型生成候选并报告 validate/update 接纳。测试把 CLI 原生 YAML 当 JSON，解析报 Unexpected token v；不能据此归因模型未行动。尚未独立断言完 revision/字段不变/第二轮运行，解析修正后再验 |

| 回执格式修正后的真实运行 | 测试在命令字符串断言处失败 | Luna 经 13 次 bash 操作、两次候选校验拒绝后自修，取得真实原始接纳回执；profile/defaults/bindings 四项比较为 true。模型采用 node+execFileSync 数组调用，测试却要求 shell 字面命令，未走到第二轮运行。后续改为记录并断言真实控制请求，而不限制合法调用算法 |

## 已实现的公共闭环

- 目标 profile 的局部配置与原有默认调用兼容；开放会话可确定的 profile 改绑提前拒绝。
- 同一管理写入链执行候选校验、锁内版本核对、同步热重载及条件回滚；回滚成功后同步恢复有效快照，恢复失败明确报告。
- 社交写入保留能力/身份/目标边界，取消第二次精确确认口令；可信主人群/私聊、parent_ask 和原生续办沿原授权办理。
- 委派拒绝/额度错误与任务完成分开，实际来源不可核验明确报错；可选覆盖字段错误提供合法恢复路径。
- 现有附件工具得到实际可用引用；原生请求模型与配置首选、历史执行事实分开。
- 随包 self-management skill 和共同系统指引给出实际管理/验收步骤；未改任何正式 Bot 的私有 persona。

真实 Luna 最终验收 **1/1 通过**（84.23 秒），测试提交 `02d41f6`。真实宿主控制面依次记录 `agents.show`、`inspect owner/group`、`agents.validate`、`agents.update`、再次 show/inspect；没有预先替模型生成候选，也不限制它必须采用某种 shell 拼写。

原始 validation 回执为 `valid:true, accepted:false, saved:false`；update 为 `valid:true, saved:true, accepted:true, restartRequired:false`，配置 revision 为 `36a3382128166394afeb72d9dad81827de588278086defc81b9e60cfed85f063`。独立比较证明私聊 profile、不涉及的 group 字段、defaults 和 bindings 保持不变。

下一条真实本机 CLI 输入进入 `profile:group`，`run.end.status:done`、`model:openai/gpt-6-luna`，实际回复含宿主所选模型与 `GROUP_PROFILE_RUN_OK`。该证据覆盖“用户要求 → 模型自行构造候选 → 校验 → 接纳热重载 → 读回 → 目标 profile 实际运行 → 本机渠道收到回复”，不是只有模型口头宣称完成。

最终 typecheck exit 0；最终 lint exit 0（1526 文件，1190 warnings / 33 infos，规模/层级通过）。完整默认测试为 460 文件通过 / 64 跳过，2491 用例通过 / 105 跳过 / 0 失败。真实测试显式单独运行，不启用全仓旧 live 测试。

原始证据保留在本机 `.cache/self-config-20261101/`：`real-luna-evidence.json`（0600）、`final-success.log`、`npm-test-final.log`、`build-final.log`、`typecheck.log`、`lint-final-success.log`；早期失败的 `attempt-3-evidence.json`、`attempt-4-evidence.json` 及各次日志不由最终成功覆盖。这些临时运行记录不提交源码。

## 未执行范围

真实 QQ/飞书新消息、正式安装升级及用户可见效果未执行。源码热重载检查不能证明正式运行服务已更换代码；本机 CLI 多 profile 验收不冒充真实 QQ 群验收。


## 默认链与自然需求：本轮补充实施

- `0e516c2`：新建非 isolated Agent 在实际 main 路由存在时生成精确同 Agent parent 协助入口；保留自定义/wildcard/isolated。明确安全的已准入群可沿既有 admission 派生缺失批次入口；QQ 官方迁移只补可证明缺件，无法确定则真实 skip。
- 宿主管理定位与可行动错误：随本轮共享实现，具体提交和最终计数待执行方返回。
- 默认链定向：7 个文件，39 通过 / 1 跳过，typecheck 通过。错误/facts 定向早期：8 个文件，45 通过 / 1 跳过。检查范围有重叠，不相加为总数。
- 并发构建失败保留：曾在 typecheck 写 dist 时并行加载插件测试，出现 `cron: views.cron.manage: declared but not registered`。确认编译/加载竞争后改为先完整构建，再执行插件测试；没有据此修改 cron 产品逻辑。最终复测另记。
- 自然输入模型切换与真实 group-kind 协议回放场景正在准备；未执行前不得写自然需求验收通过。正式 QQ/飞书、生产 home、发布安装边界保持不变。


### 补充验收进行记录（保留首次失败）

| 范围 | 结果 | 说明 |
|---|---|---|
| 错误/facts，977be0c | 实现提交 | management 动态宿主事实与可行动错误，不在 user message 教路径 |
| 默认链 lint 首轮 | 失败：home.ts 526 行 | 未放宽500行门禁；deaec8c 将 doctor 帮助归入既有peer模块，home.ts降至496行，定向22/22通过 |
| 首轮新全仓 | config-methods 1项失败 | 新断言发现 TypeBox checked() 未附可行动修复入口；在共享 checked 路径修复，定向4/4通过，不删除断言 |
| 自然私聊夹具首次 | 失败：unknown model openai/gpt-6.1-terra | 夹具漏摘取被测真实目录中的Terra元数据，openKernel即拒绝；不是模型执行失败。补真实非秘密目录，未复制凭据、未调用Terra |
| 自然私聊模型切换第二次 | 通过 | 真实Luna输入为主人原话，owner有效模型变为rightapi/claude-sonnet-5-5，真实群绑定的模型保持openai/gpt-6.1-terra；权限/defaults/bindings保留；config.reload及local delivery成功 |

自然私聊通过证据：本机 `.cache/self-config-natural-a38cd583-b2a9-464a-b30c-db80f7e84bb8.json`（0600）。实际调用仅 Luna；Sonnet/Terra 只作真实已配置目录中的目标配置，不据此宣称已调用它们。普通非@消息与群主协助链的自然场景仍待后续结果。

### 自然群场景：失败记录

- 首次在调用模型前，测试夹具的私聊 owner profile 同时提供 level 与 capabilities，被真实配置解析拒绝；删除夹具中重复字段，受限群 profile 未加管理权限。证据 `.cache/self-config-group-0252713c-45c6-4381-ab01-0a021c4f5f45.failure.json`（0600）。
- 第二次真实 Luna 运行，180秒内没有观察到目标群参与配置，未进入普通非@消息检查，不能宣称通过。证据 `.cache/self-config-group-32a8e6e7-7448-4fe2-b0cf-b9e2db731f84.failure.json`（0600）。该次只留下超时与来源ID，缺少模型/工具事件，不能推断模型未行动或某具体根因；后续仅补失败取证再运行定位，用户原话保持不变。
- 第三次定位运行保留了真实转录与事件，证据 `.cache/self-config-group-a7fe1a6f-32fa-4d82-be17-2d819cd5cef6.failure.json`（0600）。Luna 真实调用 parent_ask，parent-request 因 no-binding 拒绝，最终如实说明尚未提交、配置未改。夹具的 main 入口被设为 wake:write（只记录），创建期 helper 因不存在可运行 main 正确不派生 parent 路由；这是夹具接入错误，不是自然原话或模型未行动。随后只将 ownerHandoff 的主私聊入口修成正常可运行入口，并在调用模型前断言默认绑定已生成；群会话权限保持受限。
- 第四次 `.cache/self-config-group-2a4c0071-d183-448d-b84d-cf0069d651ef.failure.json`（0600）：parent-request 实际进入 private 主会话，群与主会话均完成真实 Luna run，但配置未变。主会话调用未指定 profile 的 inspect，实际查询 defaultProfile=group 后误把群档权限当当前权限，并重复 parent_ask 被执行门禁拒绝。当前 profile 与 CLI 结果均已标明真实目标，没有 profile 丢失。夹具另显式关闭了 owner 技能发现，恢复真实 resolveProfile 默认 skills:[*]，无模型预检证实 builtin 自管理技能 selected/indexed。
- 根据实际失败做共享修复：dc9870e 区分主会话接办/内部回传与非主会话上交，并明确 inspect 查询默认档不代表当前档；b10af3ce 按实际 sessionMode 在 main 工具目录隐藏不可执行的 parent_ask，保留执行门禁、非main行为。catalog 定向 9/9 通过；后续真实自然需求结果另记。
- 第五次 `.cache/self-config-group-acdcc1ba-1a60-43cb-8cf3-503831beb0be.failure.json`（0600）：主会话成功读取管理技能并生成 social_update dryRun 预览，但未执行应用；把未指定 profile 的 inspect 默认群档权限、以及 recording channel 未声明features的 unknown 当成障碍。实际没有write拒绝。主会话工具目录不再提供parent_ask，未见递归转交。没有发送普通第二条，未将预览视为接纳。针对真实证据修技能入口的裸 inspect 示例为显式当前对象，并说明未知metadata与实际write拒绝分开；夹具声明实际 QQChannel 已知features，不新增主动发送授权。
- 第六次实际行为走通，证据 `.cache/self-config-group-de157382-b17e-4c28-82fb-2127e0e1035e.json`（0600）：真实 parent-request 进入独立主会话；social.policy-change applied，磁盘与宿主读回均为 mode=batch/batch.run=true/delaySeconds=3；普通非@原话进入 social.batch-ready，其 sourceEvents 包含原消息，后续真实 Luna run.end=done/inputs 含该batch，取得本地delivery.ok。该次最终测试断言失败（同attempt failure.json保留）：测试把路由返回的真实session ID 30误当配置别名，应核验 session row 的 mode=main/profile=private，而不是比较字面main。普通输入发生在前次发言后的focus窗口，路由reason=batch；该live本身不证明完全无focus场景，独立二次门槛回归见d71e861。修正会话事实断言后完整测试结果另记。
- 第七次 `.cache/self-config-group-6a9c110c-d7c1-41e6-be56-f87a36e43afe.failure.json`（0600）：未稳定复现第六次成功，配置等待180秒失败，没有发送普通第二条。主会话真实为private，显式检查private确认bypass/admin/social_update可用；模型仍裸inspect查询default group，未调用写入工具即误报当前无admin。QQ features恢复后capabilityGaps已为空，证明本次不是未知渠道能力阻断。此前一次成功不足以判定稳定修复，因此暂停live，补本机执行到只读CLI检查的实际目标上下文连续性；不继续添加用户提示、不改defaultProfile掩盖。
- 已提交自然验收/夹具/checked共享错误收口 ee45e844。该点之前最近全量默认测试为461文件通过/66跳过、2502用例通过/107跳过；该计数不冒充后续上下文修复的最终结果。

### 执行上下文连续性补充

3ce144b 将实际session配置的home/Agent/profile仅传给本机bash子进程，CLI只读inspect在home匹配、无显式覆盖时沿用，输出inspectionContext；其他Agent不串profile、跨home及普通终端保持原默认，写入默认/权限不变。2文件6项定向回归通过。首次build发现Record索引在严格类型下仍可能undefined，8ee40bf用unknown局部字段的真实类型窄化修复，CLI定向通过、typecheck exit0。统一build/lint后最终自然模型及全仓结果下列。

## 本轮最终结果（包含执行上下文修复）

- 自然私聊：真实Luna用主人原话完成目标模型配置，保留真实群绑定模型、其他配置，已接纳/本地交付，见前文a38cd583证据。
- 自然群最终1/1通过，真实调用仅openai/gpt-6-luna，证据 `.cache/self-config-group-38045533-486d-4115-894f-905cdaf5e099.json`（0600）。生成的parent-request绑定指向main/private，实际会话ID30经sessions.get确认agent=main/profile=private/mode=main，与群session2隔离；parent指向首批次，首批sourceEvents包含主人原始群消息。磁盘与宿主有效读回均mode=batch/batch.run=true/delaySeconds=3。普通非@会议消息进入新batch、sourceEvents含原消息，真实Luna后续run.end=done且inputs含该batch，取得本地录制发送回执。成功证据未单列routing reason，且普通消息处于可能的focus窗口，故不据该live排除其他触发因素；无关键词/count吞批次的独立确定回归另见d71e861。
- 最终默认 npm test exit0：462文件通过/66跳过（528），2505用例通过/107跳过（2612），0失败。真实模型测试单独显式运行，不启用所有旧live。
- 最终 build exit0；typecheck exit0（8ee40bf后）；lint exit0（1207 warnings/33 infos保留，文件规模和层级检查通过）；没有放宽门禁。
- 测试及共享错误收口提交ee45e844，最后新增上下文实现3ce144b/8ee40bf，通用设计与指引bcb25f5。前述失败全部保留，一次行为成功后再次失败也如实记录，不以偶然成功替代根因修复。

本轮群测试是实际kind=group事件、真实内核/来源验证/管理工具/热接纳及真实模型，transport仅本地录制，没有真实QQ登录/平台权限验收。正式QQ/飞书新消息、发布、安装升级、正式home配置均未执行或修改；不能据此宣称生产生效。
