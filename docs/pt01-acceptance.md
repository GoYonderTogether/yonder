# PT-01 验收记录（2026-10-28）

本次为并行源码的中间快照，不代表最终提交或安装版。临时目录调用真实 initHome；main 为 main/jarvis owner，default 为手工 preset，coding 按 presetSession/presetProfile 继承 main 的权限与选择，未实际执行 task_run。按 UTF-8 字节数除以 4 向上取整，仅为估算，不是模型 tokenizer。system 包括 skills 与模板；profile.instructions 均为 0。未包括动态 turn、历史、用户文件。

| 分段 | main | default | child coding |
|---|---:|---:|---:|
| framework | 283 | 325 | 325 |
| common-identity | 64 | 64 | 64 |
| common-work | 97 | 97 | 97 |
| common-updates | 85 | 85 | 85 |
| common-writing | 47 | 47 | 47 |
| common-visuals | 35 | 35 | 35 |
| common-facts | 44 | 44 | 44 |
| common-autonomy | 81 | 81 | 81 |
| common-authority | 73 | 73 | 73 |
| common-voice | 25 | 25 | 25 |
| common-assets | 39 | 39 | 39 |
| resident-identity | 34 | 0 | 0 |
| resident-continuity | 39 | 0 | 0 |
| resident-relationships | 42 | 0 | 0 |
| resident-initiative | 40 | 0 | 0 |
| resident-work | 127 | 0 | 0 |
| resident-growth | 23 | 0 | 0 |
| runtime-identity | 5 | 5 | 5 |
| runtime-events | 66 | 66 | 66 |
| runtime-delivery | 70 | 70 | 70 |
| runtime-environment | 47 | 47 | 47 |
| runtime-capabilities | 34 | 34 | 34 |
| runtime-services | 23 | 23 | 23 |
| runtime-media | 27 | 27 | 27 |
| runtime-delegation | 60 | 60 | 60 |
| runtime-background | 68 | 68 | 68 |
| cli | 32 | 32 | 32 |
| skills | 649 | 649 | 649 |
| context-jarvis-soul | 76 | 0 | 0 |
| context-jarvis-work | 202 | 0 | 0 |
| context-task-general | 0 | 205 | 205 |
| context-task-coding | 0 | 0 | 103 |
| 完整 system（合并后计） | 2540 | 2203 | 2305 |

预算目标分别为 2400、1950、1950；估算实际为 2540、2203、2305，均超限。skills 索引各 649，分别是主要归属之一。guidelines 未计，须按当前实际 offered 重新量测。初始 catalog offered 分别 37、16、19；已取得的 schema 字节估算分别 3966、1534、1707，description 分别 2246、1080、1135；find 与 ls 的 schema/description 尚未计入，因此是下限，不能判定后两者达标。未选插件与无 exec 的指南隔离尚需真实装配复测。

真实模型：隔离临时 HOME，仅读取主人 siliconflow 凭据槽，使用 siliconflow/deepseek-ai/DeepSeek-V3.2；运行 packages/core/src/prompt/pt01-acceptance.test.ts，原始 1 测试失败。短问答回答正确、未调用账本工具；run.end input 5623、cacheRead 5760、output 10，输入合计 11383。主管创建 default 子任务，子任务读取 CONTRIBUTING.md 并找到 openai/gpt-6-luna；其报告未以 STATUS 开头，未通过协议验收。子任务 run.end input 7847、cacheRead 18688、output 539，输入合计 26535。主管在 120 秒等待内未收到 run.end，未证明验收或最终交付，主管此次运行的完整输入成本未知。原始临时事件库：/tmp/yonder-pt01-97JvZ6/.yonder/state.db。

official-prompts.test.ts：3/3 通过。预算脚本最初在并行改动期间因 kernel/index.ts 引用 workspace.ts 未导出的 projectRulesFor 导致 openKernel 加载失败；随后用 initHome 与真实配置解析路径测得上述装配，未冒充内核运行时完整请求。

后续：在最终代码收敛后重新测三角色逐段、guidelines、全部 offered schema 和稳定前缀；补齐无 exec、未选插件、上下文单次注入与子 Agent 私人信息隔离；修复 STATUS 并重跑真实主管派发、验收及短问答，记录所有 run.end 输入和缓存用量。

## 第三轮：上一轮超时诊断

原始事件库 `/tmp/yonder-pt01-97JvZ6/.yonder/state.db` 显示主管输入为 15:11:24.842Z，15:12:17.967Z 创建子任务（53.1 秒），子任务 15:13:18.322Z 完成（60.4 秒），15:13:18.330Z 产生 `runtime.tool-result`，距输入 113.5 秒。原测试只等待原输入关联的 `run.end` 120 秒，留给主管处理结果的时间约 6.5 秒，超时后关闭内核。结果事件已产生，但没有主管最终验收证据；这些记录不足以证明后台投递故障。

第三轮临时 HOME 按原口径（UTF-8 字节 / 4，向上取整，含 skills 索引、不含工具 guidelines/schema）重装配：main 2540 → 1996，default 2203 → 1771，coding 2305 → 1863。原值为上一轮并行快照，本轮含新增权限说明，因此不是同一源码基线；其后恢复“无必要时不轮询”的 11 个字节，三者的估算上界分别为 1999、1774、1866，仍不超过 2000。guidelines、schema 与真实模型闭环另行验收。

最终措辞恢复“无必要轮询”后，按装配字节差计算的保守上界为 main 1999、default 1774、coding 1866；仍为 UTF-8/4 估算，非 tokenizer 计数。`task_continue` 的指南承接了结束前排入具体下一步并确认接纳的规则。

第三轮推送后干净副本 `0edb8ee` 的全仓构建失败：并行的 code-intel 引用 SDK `ToolContext.authorizeFileWrite`，但副本中该字段尚未合入。原真实测试运行 1 个失败：短问答未调用 tasks 工具，委派阶段 120 秒内未观察到所等的 run.end；证据目录 `/tmp/yonder-pt01-nJu8Tn`。该失败不能作为闭环通过的证据。

推送后的真实测试首轮：default 1 通过（coding 跳过）；coding 1 失败（default 跳过），执行者给出正确路径和模型，主管已验收，但报告以 `**STATUS: done**` 开头，未满足首字符为 `S`。coding 原始证据 `/tmp/yonder-pt01-EDstnW/evidence.json`。随后明确禁止 Markdown 包裹，需复跑。干净副本 `1a8499f` 构建通过，早前构建失败保留如上。

STATUS 字面格式修正已提交；复跑待完成。`verify-copy.sh` 后续多次提示其他验收 HOME `t05r3` 运行中，拒绝更新副本，未停止他人进程。现有 `verify-home.sh` 还会从主人 HOME 复制 gw 槽，本卡仅授权 siliconflow，故未运行该脚本或 `real-check.sh`。三角色最终上界按此次任务文本新增字节计算为 1999 / 1795 / 1887，非模型 tokenizer 实测。
