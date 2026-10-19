# 自管理技能与能力边界收敛

日期：2026-10-19。用户要求不补通用编码、修bug或GitHub教程；让LLM自行选择已有工具。仅新增Yonder特有自管理skill；研究真实媒体、定时及goal/task缺口；提示词模板插件先设计。参考skill-creator和ponytail，不复制另一套运行核心。

## 分工与允许路径

- Sol自管理：仅`skills/yonder-self-management/`，入口和一个按需reference。
- Sol媒体：仅`docs/tasks/media-capability-review.md`，只读源码/配置元数据及必要官方协议资料。
- Sol定时/目标：仅`docs/tasks/scheduling-goal-review.md`，官方来源与现行接线。
- 主路：本记录、`docs/tasks/agent-template-proposal.md`、`packages/core/src/skills/skills.test.ts`与必要`docs/function-tree.md`/`docs/plugins.md`目录项；亲自审核、最小发现检查及结果。

不改冻结规范、SDK、内核、正式home或安装；不新增通用skill包；不执行收费媒体调用、飞书发消息、安装、推送或发版。新插件功能先提交方案审核，通过后先更新对应规范与决策再实现。

## 当前事实

- 本机注册main（Luna）、maintainer（Sol）、operator（Luna）；只有一个home preset `default`（Luna、standard、plugins=[]、instructions为空）。这些是当前本机配置，不是全局内置角色库。
- profile是同一Agent的权限/模型分身；preset是无独立身份的任务模板；task_run是原生父子任务；agent_ask联系已登记Agent，不能创建Agent，也不是task_run的别名。
- 新常驻Agent登记在yonder.yaml，需外部重启；已有agent.yaml和presets可热重载。具体规约已放自管理skill。
- 当前SYSTEM为空白职责模板；主Agent的AGENTS只有简短中文、真实结果和分工规则。context-files提供加载/初始文件，不是完整角色设计器。
- 正式home services=[]；现有Models目录不是媒体生成API。媒体接口候选复用services.resolve及附件通道，不声称ChatGPT订阅等于生成API授权。

## 结果与检查

- 新增`yonder-self-management`及一个按需reference，未改skill发现器或运行代码；既有开发/调试skill保留，不新增通用编码/GitHub技能。
- 主路逐条核对CLI、config/reload、注册加载、工具和权限事实，补正“仅当tool_search已提供才调用”以及events帮助入口的指导。
- 更新已有skills聚焦检查：1文件/5通过/0失败/0跳过，真实YAML解析、builtin索引、正文不注入和reference按需读取均通过，日志`/tmp/yonder-self-management-skills-test.log`。`biome check packages/core/src/skills/skills.test.ts`及git diff --check通过。
- 上游creator Python quick_validate因系统缺PyYAML失败；未新增依赖，未将其记录为通过。项目实际加载检查通过不能抵扣上游Python脚本环境缺失。
- 三路Sol任务已结束；媒体与cron/goal报告是研究/方案，agent-templates是主路设计。没有插件功能体、收费API调用或真实调度验收，不冒充已实现。
- 未改冻结文档、正式home、安装或发布。本机正式版仍1905；新self-management技能只在本轮源码可发现，尚未安装。未重跑全仓矩阵、未运行新模型测试或外部发消息。
- `.claude/`为原有未跟踪内容，未触碰或纳入提交。下一轮插件范围与默认行为需用户审核；媒体真实接入还需用户指定服务/凭据引用。

## 2026-10-19 用户追加：Agent 管理修订

用户要求名字与工作分开、常驻 Agent 无需重启增删改查、删除只归档、preset 热重载、模板生成及自动配置检查。已据源码与正式 home 更新 [Agent 管理方案](agent-template-proposal.md)，待审核；原文“新增注册必须重启”仍是当前已安装实现的事实，拟由新一轮替代，不是继续保留该产品限制。系统灵魂提示词与人格/职责 preset 内容推迟到下一阶段。本轮未改运行代码和正式配置；不把方案写作已实现。
