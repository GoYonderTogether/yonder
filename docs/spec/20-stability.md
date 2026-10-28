# 20 稳定性与兼容策略

> 本文是 0.3 起“不可破坏的东西”与弃用规则的唯一权威。golden 测试与检查脚本都指向本文；本文与 [contracts.md](../../proposals/unified-client/contracts.md) §5 的协议版本规则一致，冲突时以 contracts.md 为准并先在 [decisions.md](../decisions.md) 记一条。

## 1. 冻结清单

0.3 起，下列各项只增不删、不改名、不改类型、不收紧必填。变更只能走 §4。

| 类别 | 冻结内容 | 依据 |
|---|---|---|
| home 布局 | `<home>/yonder.yaml`、`presets/`、`skills/`、`agents/<id>/`，以及 `<home>/.yonder/` 下的 `state.db`、`auth.json`、`device-id`、`lock`、`control.sock`、`status.json`、`service-host.json`、`logs/`、`plugins/<id>/`、`attachments/` | 08 §1 |
| 环境变量（公开） | `YONDER_HOME`、`YONDER_INSTALL`、`YONDER_PUBLIC_ORIGIN`、`YONDER_GATEWAY`；其余 `YONDER_*` 为内部变量，不受本文保护 | 09 |
| 命令与二进制 | `yonder`、`yonder-executor`（另有 `yonder-qq`、`yonder-clipboard`）；`yonder` 的子命令名与既有选项 | 09、reference.md |
| 包名 | `@yonder/*` 全部包名 | 04 |
| 插件 id | 随包插件的 id 与其工具名前缀 `<pluginId>_`；id 格式 `[a-z][a-z0-9-]*` | 04 §1、§3.2 |
| helper 标识 | macOS helper bundle id `dev.yonder.harness.helper`（绑定 TCC 授权与签名）与 power helper `dev.yonder.power`：永久冻结，不随任何改名变化 | 05 |
| hash 路由 | `apps/app` 的 `#/…` 路由字符串（含 `#/s/<id>`、`#/contacts`、`#/work`、`#/me` 等已发布路径） | S-F03 |
| gateway 方法 | 方法名、`scope`、`since`、参数与结果 schema；`protocol = 1` | contracts.md §1、§5 |
| gateway 事件 | `ev.type` 清单及各类型的必有字段；`seq` 语义 | contracts.md §3 |
| views 协议 | placement（`rail`/`floating`/`page`）、`ViewDecl`、`ViewData`、`ViewsChangedEv` 的形状 | contracts.md、`@yonder/sdk` |
| `yonder.yaml` | 顶层键、各键含义与取值；agent 配置档与 preset yaml 的字段（同 08、03 §4） | 08 |
| `state.db` schema | 现有表与列的名称、类型与语义；`y_meta.schema_version` 基线为 v1 | 07 §1 |
| 状态快照 | `status.json` 的 `schemaVersion: 1` 与 protocol 中同名字段 | `core/src/status/snapshot.ts`、`protocol/src/schema.ts` |
| SDK `apiVersion` | 插件 `package.json` 的 `yonder.apiVersion`（当前 `1`）与内核支持的集合；缺省视为 `1` | 04 §6 |

内部实现不在冻结之列：未导出的函数与模块、`scripts/yonder-*.mjs` 辅助脚本、日志文件名（`harness.log`、`status.log`）、launchd/systemd 标签的实现细节（由迁移负责，见 §3）。

## 2. 允许的变化

同一主版本内只增不删（contracts.md §5）：

- 新增方法、新增可选参数、新增结果字段、新增事件类型、新增枚举值。
- 新增 `yonder.yaml`、agent、preset 的可选键；新增 `.yonder/` 下的文件。
- 新增 `state.db` 的表，或带默认值的新列，且通过迁移执行（§4）。
- 新增路由、新增 views 可选字段。

客户端必须忽略未知 `ev.type`、字段与枚举值；服务端必须忽略未知请求字段，缺省的可选参数取旧行为。

## 3. 弃用策略

1. 被替代的名字（命令、工具、路径、标签、路由、方法）保留别名或 shim，至少跨 2 个 minor 发布；0.3 弃用的，0.3、0.4 保留，最早 0.5 移除。
2. 每个弃用项必须同时有：运行时 warn（使用旧名时输出，指明新名与移除版本）和 `CHANGELOG.md` 条目。缺任一项不得宣布弃用。
3. 方法弃用在 `MethodDef.deprecated` 中标明；旧语义至少保留一个发布版本，协议层规则见 contracts.md §5 第 2 点。
4. 移除前须确认已过上述保留期，并在 `docs/decisions.md` 记录。

## 4. 破坏性变更流程

确需删除、改名、改类型或收紧必填时，按顺序全部完成：

1. 在 `docs/decisions.md` 记一条决定（含理由与代价）。
2. 提升对应版本号：协议用 `protocol`，插件 API 用 `apiVersion`，`state.db` 用 `schema_version`，配置文件用其版本键。
3. 提供迁移：`state.db` 迁移前备份（`VACUUM INTO`）且拒绝降级；home 或安装树迁移走 `yonder migrate`（09），可预览、可回滚。
4. 旧形态按 §3 保留别名并发出 warn。
5. 更新对应 golden 文件，并在 PR 说明里点名变更项。

## 5. 自动检查

冻结项由 golden 文件或测试守护。规则：golden 必须是当前实现的子集；删除、改名、改类型、收紧必填即失败，只增不删通过。刷新 golden 只能在 §4 流程内进行。

| 冻结项 | 检查 | 卡 |
|---|---|---|
| gateway 方法 | `packages/core/src/control/registry.golden.test.ts` ↔ `packages/protocol/golden/methods.json` | S-C02 |
| gateway 事件 | `packages/gateway/src/events.golden.test.ts` ↔ `packages/protocol/golden/events.json` | S-C03 |
| `yonder.yaml`、agent、preset schema | `packages/core/src/config/schema.golden.test.ts` ↔ `schema.golden.json` | S-C04 |
| 插件 `apiVersion` | SDK 导出 `API_VERSION`，加载器强制检查（测试随该卡） | S-C05 |
| `state.db` schema | `y_meta.schema_version` 与迁移执行器测试（随该卡） | S-C06 |
| views 协议 | `packages/sdk/src/views.golden.test.ts` ↔ `packages/sdk/golden/views.json` | S-C07 |
| 聚合入口 | `scripts/check-stability.mjs` 一条命令跑全部冻结检查，进 CI | S-C08 |

home 布局、环境变量、命令名、包名、插件 id、hash 路由目前没有独立 golden，由 S-C08 的聚合脚本或各自卡片补充；补齐前，改动这些项按 §4 走评审。
