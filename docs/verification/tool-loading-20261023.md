# 按需工具加载故障验收（2026-10-23）

## 范围与真实故障

复核本机运行转录、pi.agent 历史和 harness 日志；只读快照截至 2026-10-23 06:40:20.294 UTC。当天有同轮四次 task_run 在加载前被拒绝；两次包含准确工具名的长搜索返回空，单名搜索成功。没有发现此事件中已经加载的工具在运行内被意外卸载的证据。

具体对比、源码链接和采用范围见 [参考记录](../research/tool-discovery-20261023.md)。变更只修共享检索、未加载调用的恢复提示与发现指引；保留权限过滤、插件选择、拒绝调用不执行、同轮 append-only 加载、下一轮重置和现有压缩。未补执行或重放生产委派，没有向日用主会话发送验收消息。

## 源码与测试

- pi fork：`59cfaf09379465ef6bef25845c6864403e742537` 已推送 yonder/1.3，并由同步脚本按完整 SHA 内化。纯检索回归覆盖事故原查询、中英文混合、大小写、插件名称、点分名称和完整标识边界；既有 tool-search、Code Mode、模型调用 guard、嵌套工具及重启恢复回归合计 **139 通过 / 0 失败**。
- fork 首次 `npm run check` 因从原生 generation 导入可选 tool-search 入口，触及 entry graph 预算而失败；移除该运行依赖，保持可选入口边界后完整 check 通过。未调整预算或绕过检查。
- Yonder 第一轮默认全仓 **408 通过 / 10 失败 / 37 跳过（455）**，真实模型定向 **0 通过 / 1 失败**。均在 initHome 加载主线新增 agent-presets 时失败：旧工作树尚未按新锁文件安装工作区依赖，未进入检索。原始输出保留在本机私有验收目录。
- `npm ci --ignore-scripts` 按现有锁文件安装后：build、typecheck、内化工作区解析检查 exit 0；默认全仓 **418 通过 / 0 失败 / 37 跳过（455）**，98 文件通过 / 18 跳过。没有修改依赖版本、断言或模型调用超时。
- 真实 `openai/gpt-6-luna` 定向 **1 通过 / 0 失败**：中文自行发现 cron_manage → 只读 list → 下一轮恢复常驻；再用原事故 query 加载 task_run（不执行委派）→ 关闭并重开内核 → 新一轮恢复常驻。
- lint exit 0，保留主线已有 **325 warnings / 13 infos**；权限 helper self-check **36 通过 / 0 失败**。

默认跳过项未当作真实模型通过。真实模型验收在隔离 home 使用已有凭据路径，不复制 OAuth，不向生产会话发送消息；它验证正向发现与恢复，未要求模型故意输出未提供 schema 的非法调用。非法调用的无副作用边界由既有原生 guard 回归覆盖，新增恢复文案按实际 deferred/caller 过滤分支审查。

## 本机边界

修改前备份配置、提示词和事故数据库快照于服务 home 的 `.yonder/backups/tool-loading-20261023/`；快照用于审计，不自动覆盖当前数据库。既有权限、插件、工具配置和维护者归档状态保持。主 Agent 19，维护者配置 11，Hermes 5，default 子任务 10（含有 deferred 时的 tool_search）。

## 发布准备

整合主线 `950b12e` 后准备正式版本 `0.2.26102306`，仅统一根与 24 个 @yonder 工作区版本及锁文件；上游 pi-durable 保持 1.3.0。新基线再次 build、typecheck、lint 和工作区解析检查 exit 0；默认全仓 **418 通过 / 0 失败 / 37 跳过**，真实 Luna 定向 **1 通过 / 0 失败**。既有 lint warnings/infos 数量不变。

## 安装版与服务

- 主线提交 `a9165fe367dd69371ca2ee005ff8ac11762d6191` 的 [macOS CI 39914843740](https://github.com/GoYonderTogether/yonder-harness/actions/runs/39914843740) 全部通过，标签 v0.2.26102306 固定于此提交。
- 安装前确认当时只有原生模型请求和内部等待，没有正在执行的工具；沿现有 service stop / update 流程安装，未重复分派原任务。更新返回 `verified=true`、`restartRequired=false`，实际 service.info 确认 **0.2.26102306 / a9165fe / pid 57080 / ready=true**，home 为本机原服务 home。
- 直接 import 安装目录 `versions/0.2.26102306/packages/core/dist/kernel/index.js` 的编译产物，在隔离 home 使用真实 Luna 完成三轮：中文任务自行搜索 cron_manage 并只读 list；原事故 query 加载 task_run、没有执行委派；关闭重开内核后的新一轮恢复十个常驻工具。实录调用为 tool_search → cron_manage → tool_search，原 query 参数逐字相等，断言全部通过。没有把源码运行或生产主会话回复算作这次安装版验收。
- 更新后 doctor `ok=true`、无错误，仅原有 exec 管理权限警告。备份的 11 份配置与提示词文件哈希逐字一致；没有更改权限、插件、常驻列表、个体正文或归档状态。原始结果、版本信息与编译产物验收脚本保存在本机私有备份。

正式发布入口：[0.2.26102306 Release](https://github.com/GoYonderTogether/yonder-harness/releases/tag/v0.2.26102306)。本次未做 Claude 非法调用生成行为的强制实验，也未重新验证与该检索修复无关的外部渠道/network 告警；这些不计为通过。
