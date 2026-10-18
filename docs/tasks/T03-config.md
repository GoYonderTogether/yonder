# T03 配置加载、校验与热重载

**依据**
- `docs/spec/08-config.md:1-97`（全文）
- `docs/spec/03-agents.md:12-84`（工作区、agent.yaml、配置档、预设）
- `docs/spec/02-sessions.md:34-85`（绑定的全部字段）
- `docs/spec/05-security.md:21-32`（级别）

**路径**：`packages/core/src/config/`

**必须**
- 用 TypeBox 定义 `yonder.yaml`、`agent.yaml`、预设的 schema；一次报告全部错误，带文件名与字段路径。
- `schema` 版本检查：未来版本拒绝，过去版本提示迁移命令。
- 配置档字段按 `03-agents.md:59-76` 的继承顺序合并（配置档 → `defaults` → 内核默认）。
- `level` 与 `capabilities` 同时出现即报错。
- 绑定校验：`id` 唯一、`profile` 存在、`match` 只含五个维度。渠道 `kind` 的交叉校验放在 T06 之后由 doctor 做。
- 工作区读取经由执行环境接口（架构不变量 8）：本任务对接一个只含 `readFile`/`writeFile`/`exists` 的最小接口，由 T05 用 pi 的 `ExecutionEnv` 实现。
- 热重载：`agent.yaml` 与 `presets/*.yaml` 变化后重新校验，成功则替换，失败保留旧配置并产生 `config.reload` 事件的输入（写入由 T04 的存储完成）。

**禁止**：规范外的配置项；默认值与规范不一致。

**验收**：`08-config.md` 中的两个示例原样能通过校验；每类错误至少一个测试；热重载成功与失败各一个测试。

## 问题

（无）
