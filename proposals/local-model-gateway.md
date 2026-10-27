# 本机模型网关：现状、选型与设计提案

状态：提案，供维护者评审。不是运行时契约，不改 `docs/spec/`。
本文只写公开技术事实与设计取舍，不含账号、密钥、会话内容。

## 1. 本机现状（2026-10-27 实测）

### 1.1 有残留，且曾经跑通过

| 位置 | 事实 |
|---|---|
| `~/Documents/github/freellmapi` | FreeLLMAPI v0.13.2，MIT，594 MB（含 node_modules），最后提交 2026-09-29 |
| 运行方式 | `node server/dist/index.js`，dashboard 与 `/v1` 同在 `http://localhost:3001` |
| 数据 | `server/data/freeapi.db`（SQLite，key 加密），`.run/server.pid`、`.run/server.log` |
| 已验收 | 2026-09-30 实测 12 个免费渠道全部 PONG，14 条 key 行 / 12 条启用 |
| 当前状态 | 未运行。3001 端口空闲。launchd 模板已备但未安装 |
| 文档 | `RUNBOOK.local.md`（本机笔记，`.git/info/exclude` 排除） |

它自带 MCP 服务（`server/src/routes/mcp.ts`，616 行），已暴露 8 个工具：
推理、就绪检查、模型列表、渠道 key 健康、用量统计、路由策略读写、缓存统计、压缩统计。
这已经覆盖「让 Agent 自己看网关、自己改路由」的大半需求。

### 1.2 其他相关残留

- `~/.dsh/settings.yaml.pre-freellmapi.bak`：曾把 freellmapi 配成 provider，
  `baseURL: http://127.0.0.1:3001/v1`，模型别名 `auto`、`fusion`、
  `claude-opus-4-5`（注释写明「Opus slot (auto-routed to a free model)」）。
  这就是「同一模型名映射到免费渠道」的既有做法。
- `~/.cc-switch`：GUI 供应商切换器，`enableLocalProxy: false`，未启用内置代理。
  `cc-switch.db` 50 MB。它是切换器，不是网关。
- 本机没有 LiteLLM / one-api / new-api / Bifrost / CLIProxyAPI 的目录或进程。

### 1.3 「第二个 ChatGPT 供应商」为什么建不出来

这不是网关问题，是 yonder 的模型账户模型。

- `docs/spec/07-runtime.md` §6.1：`models.providers` 的 id 与 pi 内置供应商相同，
  就**叠加**在内置供应商上，沿用它的鉴权（含 OAuth）。
- 其他 id 走 `createProvider({ auth: { apiKey: envApiKeyAuth(id, []) } })`，
  **只有 API key，没有 OAuth**。
- 所以第二个 ChatGPT 订阅账号不能靠「新建一个 provider」实现。

正确入口是命名凭据槽，已在实现中：

```
yonder login openai --slot work            # 第二个 ChatGPT 账号
yonder credentials slots list|status|create|remove
```

`docs/spec/09-cli-release.md` 第 21 行、`packages/cli/src/index.ts` 第 47–48、441–567 行。
profile 用 `credentialSlots: { openai: work }` 选择槽（`docs/spec/03-agents.md` §3）。
槽只换账号，不改模型名，也不引入跨槽轮换。

结论：多账号走槽；多供应商、多协议、免费额度池走网关。两件事不要混。

## 2. 结论

1. **不自建数据面。** 协议转换、流式、工具调用、配额、冷却都是长期维护债，
   与「一个逻辑改动一个提交」的节奏冲突。
2. **自建一层薄控制面。** 只做别家都不做的事：模型别名、能力注解、额度快照、审计。
3. **网关不进 yonder 进程，也不做插件进程。** 它是本机独立服务，
   yonder 用 `models.providers` 接一个 provider，Agent 用现有 `mcp-client` 接 MCP。

## 3. 三层结构

```
L2 接入面   /v1（OpenAI 兼容）  /mcp（Streamable HTTP）  CLI  快照图
                              │
L1 控制面   gw：别名表 · 能力注解 · 链与健康 · 额度 · 审计       ← 自建，约 2k 行
                              │
L0 数据面   freellmapi（免费池）  CLIProxyAPI（订阅额度）  直连 provider
```

### 3.1 为什么 L1 值得自建

| 需求 | 现成项目 |
|---|---|
| 模型别名 + 回退链 | freellmapi 有 named chain；new-api 有模型映射 |
| 渠道健康与冷却 | freellmapi、new-api、Bifrost 都有 |
| 免费额度池 | freellmapi 专长 |
| 订阅账号转 API | CLIProxyAPI 专长 |
| **DIY 能力注解，供 Agent 选模型** | **没有** |
| **额度快照成图，直接发给用户** | **没有** |
| **Agent 通过 MCP 改配置并自检** | freellmapi 部分有 |

L1 只需要补最后三行。前四行全部借。

### 3.2 路由权只放一处

两层都做回退，会出现重试放大和状态不一致。分工固定为：

| 层 | 负责 | 不负责 |
|---|---|---|
| gw（L1） | 一个别名内部的多 target 链、冷却、额度闸门 | 跨别名 |
| yonder `fallback` | 别名 → 另一个别名，或直连内置 provider | 别名内部 |

gw 内部同一 target 失败**不重试**，直接下一个 target。
yonder 侧 SDK 重试已为 0（07 §6.1），不叠加。

## 4. 数据模型

单文件 SQLite，`node:sqlite`，无 native 依赖。

```sql
-- 别名：Agent 与 yonder 只看得到这一层
alias(id, display, context_window, max_tokens, price_in, price_out, price_as_of)
-- 链：别名 → 有序 target
target(alias_id, ord, upstream_id, upstream_model, enabled)
-- 上游：数据面实例
upstream(id, kind, base_url, credential_ref, notes)
-- 健康
health(upstream_id, state, fail_streak, last_ok_at, cooldown_until, last_error_class)
-- 额度：多数上游没有 quota 接口，只能估算 + 人工校正
quota(upstream_id, kind, limit_value, used_value, reset_at, source, as_of)
-- 注解：给 Agent 看的短句
note(alias_id, best_for, avoid_for, caveats, updated_at)
-- 用量与审计
usage(req_id, alias_id, upstream_id, tokens_in, tokens_out, cache_read, cache_write, cost, status, ms, at)
event(id, at, actor, action, before, after)
```

`note` 是这套设计的核心差异点。它存的是人写的短句，不是营销文案：

```
best_for: 长上下文整仓阅读；结构化重构
avoid_for: 需要精确算术；需要最新事实
caveats: 工具调用偶发丢参数；429 后 60s 内不要重试
```

Agent 选模型时读 `gw_models` 就能拿到这些句子。

## 5. MCP 工具面

统一前缀 `gw_`，返回小、结构化、可直接决策。

| 工具 | 作用 | 权限 |
|---|---|---|
| `gw_overview` | 端口、上游数、可用别名数、总体健康 | 读 |
| `gw_models` | 别名 + 注解 + 上下文 + 价格 + 当前健康 | 读 |
| `gw_quota` | 各上游剩余额度、重置时间、数据来源 | 读 |
| `gw_usage` | 时间窗内 token、请求数、成本、成功率 | 读 |
| `gw_snapshot` | 生成 PNG 快照并作为图片返回 | 读 |
| `gw_probe` | 主动探测一个 target，花 1 token | 写 |
| `gw_alias_set` | 建/改别名与链 | 写 |
| `gw_note_set` | 写能力注解 | 写 |
| `gw_doctor` | 配置、连通性、凭据、端口诊断 | 读 |

写操作要求 admin 能力。readonly 会话只拿到读工具。
这沿用 yonder「能力 + 级别」的单层判定，不新增审批。

## 6. 与 yonder 的接法

### 6.1 模型侧：只加一个 provider

```yaml
models:
  providers:
    gw:
      baseUrl: http://127.0.0.1:8787/v1
      api: openai-completions
      authHeader: true
      models:
        - { id: fast,  name: 快模型, contextWindow: 1048576, maxTokens: 32768 }
        - { id: smart, name: 强模型, contextWindow: 1048576, maxTokens: 65536 }
```

- 34 个上游**不**写进 `yonder.yaml`。yonder 只看见 2–5 个别名。
- 别名内部换渠道、换 key、加免费渠道，yonder 无感，不需要重启。
- 凭据用 `yonder credentials set gw` 写入 `auth.json`，不写进 yaml。

### 6.2 工具侧：复用现有 mcp-client

`docs/spec/14-execution-capabilities.md` 已支持 StreamableHTTP。
把 `http://127.0.0.1:8787/mcp` 配成一个 MCP 服务即可，不新写插件。

注意两点：
- HTTP 传输需要 `network` 能力；readonly 会话不能因此越权。
- 工具名保留 `<pluginId>_<name>` 规则，实际暴露为 `mcp-client_gw_models` 之类。

### 6.3 对账

gw 在响应头返回 `x-gw-request-id`、`x-gw-alias`、`x-gw-upstream`。
yonder 的 `pi.usage` 按 `gw/<alias>` 记 token 与 cost。
两边按 request id 对账，不互相猜。

额度只有 gw 知道；单次成本只有 yonder 知道。两边都保留，不做单一事实源。

## 7. 快照

`gw_snapshot` 的路径：

1. 服务端渲染固定版式 SVG（额度条、健康点、今日 token、成本）。
2. SVG → PNG。
3. 作为图片块返回，Agent 直接发给用户。

PNG 转换有两种做法，需维护者选一个：

| 方案 | 代价 |
|---|---|
| `@resvg/resvg-js` | 约 10 MB native 依赖，输出稳定 |
| 只出 SVG + 本地 HTML 页面 | 零依赖，但工具结果不是图片 |

## 8. 开源对比（2026-10 核实）

| 项目 | 形态 | MCP | 回退/路由 | 额度计费 | Web UI | 许可 |
|---|---|---|---|---|---|---|
| FreeLLMAPI | Node + SQLite | 有，8 工具 | 策略 + 冷却 | 免费池额度 | 有 | MIT |
| CLIProxyAPI | Go 单二进制 | 无 | 多账号轮询 | 订阅额度 | 社区提供 | MIT |
| new-api | Go 单二进制 | 无 | 优先级/权重/重试 | 强，含缓存计价 | 强，7 语言 | AGPLv3 |
| LiteLLM | Python（Rust core） | 有，MCP gateway | 有 | 有，虚拟 key | 有 | MIT + 商业 |
| Bifrost | Go | 有，gateway 属企业版 | 有 | 有 | 有 | Apache 2.0 |

选型规则：

- 要「今天就能用、自带 MCP、和 yonder 同栈」→ **FreeLLMAPI**。
- 要「订阅账号变免费额度」→ **CLIProxyAPI**，作第二上游。
- 要「强计费、中文 UI、单二进制」→ new-api，但 AGPL，且要自己补 MCP。
- 不选 LiteLLM 作本机主网关：Python 依赖重，Rust core 与 Python 层分工未在 README 说清。
- 不选 Bifrost：MCP gateway 属企业版。

### 8.1 FreeLLMAPI 的已知代价

- 594 MB，主要是 node_modules。运行内存未实测。
- 默认监听 `[::]`，局域网可达。必须设 `HOST=127.0.0.1`。
- 免费版模型目录比付费版晚 30 天。新免费模型不会当天出现。
- 上游更新快（8 天 6 个版本），自改代码要持续跟。

## 9. 免费额度：合规边界

- 订阅 OAuth 只能本机独立登录。**禁止**复制其他程序的 token（07 §6.2）。
- 免费渠道 429 如实返回，不伪装成成功（11 §1）。
- 网关不导出订阅 token，不把账号共享给非本机。
- 每个渠道的免费条款由使用者自己确认；网关只做技术聚合。

## 10. 分期

| 阶段 | 内容 | 代码量 |
|---|---|---|
| P0 | 起 freellmapi，yonder 加 provider，直接用它的 8 个 MCP 工具 | 0 |
| P1 | `gw` 控制面：别名、注解、额度、快照、透传 | 约 2k 行 |
| P2 | 接 CLIProxyAPI 作第二上游，跨上游选路 | 约 500 行 |
| P3 | 数据面可换（new-api/Bifrost），L1 不变 | 0 |

P0 当天可做。P1 才需要写代码。P1 完成前不碰 yonder 源码。

## 11. 不做什么

- 不把网关塞进 yonder 内核或插件进程。理由：生命周期、崩溃隔离、其他客户端也要用。
- 不做多租户、充值、支付。
- 不做语义缓存（freellmapi 已有，先用它的）。
- 不做权重负载均衡。默认按链序，够用。
- 不写模拟渠道、假额度、示例数据。

## 12. 待维护者决定

1. `gw` 放本仓库 `plugins/`，还是独立仓库？放仓库内则受插件契约约束，
   但它是服务不是插件，槽位不匹配。
2. 网关能否写 `yonder.yaml`？建议**否**，模型配置仍由人改。
3. 快照用 native 依赖换 PNG，还是只出 SVG？
4. 额度数据没有统一接口，多数只能估算。估算值是否允许写进 Agent 可见字段？
   若不允，`gw_quota` 只能返回 `unknown`。

## 13. 未测项

- 未启动 freellmapi，未复跑 12 渠道。
- 未验证其 MCP 端点在当前版本的实际握手。
- 未验证 yonder 自定义 provider 从 `auth.json` 取 key 的行为（spec 写的是 env 鉴权）。
- 未测 `@resvg/resvg-js` 在 Node 22 的构建。
