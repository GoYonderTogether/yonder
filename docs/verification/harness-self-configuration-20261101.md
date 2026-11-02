# Harness 自配置闭环：实施与验证

方案：[行为契约与分工](../research/harness-self-configuration-20261101.md)。日期按本聊天 America/Caracas；源版本 main `f92dfe0e`（0.3.26110110），本机正式安装调查时仍为 0.3.26103105，两者不能混为同一运行环境。

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
