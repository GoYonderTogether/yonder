# T03 配置加载、校验、热重载

**依据**
- `docs/spec/08-config.md:1-105`（全文）
- `docs/spec/03-agents.md:12-86`（工作区、agent.yaml、配置档含 `skills`、预设）
- `docs/spec/02-sessions.md:36-97`（绑定的全部字段与 §2.4 加载时校验）
- `docs/spec/05-security.md:21-32`（级别）
- `docs/spec/04-plugins.md:37-67`（`channels` 实例写法）、`07-runtime.md:43-57`（`limits` 的键与默认值）

**路径**：`packages/core/src/config/`

**必须**
- 依赖 `yaml@2.9.1`；用 TypeBox（`typebox@1.3.27`）定义 `yonder.yaml`、`agent.yaml`、预设的 schema；一次报告全部错误，带文件名与字段路径。
- `models.providers`、`compaction` 只校验为对象，内部结构在 T05 交给 pi 时检查；`channels.<id>`、`envs.<id>` 只校验 `type` 与 id 格式，其余字段由提供者的 `configSchema` 在 T06 校验。
- `schema` 版本检查：未来版本拒绝，过去版本提示迁移命令。
- 配置档字段按 `03-agents.md:60-78` 合并（配置档 → `defaults` → 内核默认；`skills` 内核默认 `["*"]`，`limits` 默认见 07 §5）。
- `level` 与 `capabilities` 同时出现即报错；`ephemeral` 绑定的 `wake` 不是 `run` 即报错。
- 绑定校验：`id` 唯一、`profile` 存在、`match` 只含五个维度、02 §2.4 的同会话同配置档规则。渠道 `kind` 的交叉校验由 `doctor` 在插件加载后做。
- 工作区读取经由执行环境接口（架构不变量 8）：本任务定义只含 `readFile`/`writeFile`/`exists`/`list` 的最小接口，由 T05 用 pi 的 `ExecutionEnv` 实现。
- 热重载：`agent.yaml` 与 `presets/*.yaml` 变化后重新校验，成功则替换，失败保留旧配置并产生 `config.reload` 事件的输入（写入由 T04 的存储完成）。

**禁止**：规范外的配置项；默认值与规范不一致。

**验收**：`08-config.md` 中的示例原样通过校验；每类错误至少一个测试（含 02 §2.4 的三种冲突）；热重载成功与失败各一个测试。

## 问题

（无）
