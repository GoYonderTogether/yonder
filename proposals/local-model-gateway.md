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
| 当前状态 | **已常驻**。launchd `com.zoran.freellmapi`，监听 `127.0.0.1:3001`，RSS 114 MB |
| 文档 | `RUNBOOK.local.md`（本机笔记，`.git/info/exclude` 排除） |

2026-10-27 复跑结果：

- `/readyz` → `ready_upstreams: 10`，可用模型 126，MCP 已启用，9 个工具。
- 渠道：agnes、aihorde、custom×2、google、kilo、llm7、openrouter、ovh、xkiro、zhipu 全部 healthy。
- 关闭：github（Clash 拦截）、ollama（需付费）、groq（key 失效，待重新登录）。
- 真实请求 `auto:fast` → `xkiro/qwen/qwen3.7-max:free`，HTTP 200。
- 模型按 intelligence_rank 升序（小 = 强）：`qwen3.8-max:free` 17、`gemini-3.8-flash` 25、`gemini-3.7-flash` 29。

它自带 MCP 服务（`server/src/routes/mcp.ts`，616 行），已暴露 9 个工具：
`ask_freellmapi`、`healthcheck`、`list_models`、`provider_health`、`usage_summary`、
`routing_info`、`set_routing_strategy`、`cache_stats`、`compression_stats`。
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
2. **fork，只改 MCP 读层。** 不改供应商、不改路由算法、不改前端。
3. **网关不进 yonder 进程，也不做插件进程。** 它是本机独立服务，
   yonder 用 `models.providers` 接一个 provider，Agent 用现有 `mcp-client` 接 MCP。

### 2.1 为什么是 fork，不是外挂薄层

实测后修正：原提案建议外挂一层 `gw` 服务，理由是不碰上游。数据推翻了这条。

| 事实 | 含义 |
|---|---|
| 注解、额度、冷却、价格、已知缺陷全在 `freeapi.db` 里 | 外挂服务必须读别人的库，schema 一变就崩 |
| 缺的只是「把这些字段发给 Agent」 | 补丁面是 `routes/mcp.ts` 一个函数 |
| `resolveQuirksByModel(db)` 已存在，只被导出脚本用 | 不用新建缺陷表 |
| `mcp.ts` 历史上只改过 7 次，最近 30 天共 20 个提交 | rebase 冲突面小 |
| 路由、供应商、客户端都在别的目录 | 全部不碰 |

外挂薄层的代价是多一跳、多一套鉴权、多一份 schema 耦合，换来的只是「不 merge」。
不值得。

### 2.2 fork 的边界

允许改：

- `server/src/routes/mcp.ts`：`listModels` 增加 `price`、`quirks`、`quota`、`rank`。
- 新增 `server/src/routes/snapshot.ts`：额度与健康快照，出 SVG。
- 新增 MCP 工具 `set_model_note`：写 `quirks` 表，不新建表。
- `server/src/app.ts`：挂载新路由，一到两行。

禁止改：

- `server/src/providers/`：任何上游适配。
- 路由算法、冷却策略、fallback 打分。
- `client/`：前端不重做。
- 数据库既有列语义。

合并纪律：保留 `origin` 指上游，自有提交只进 `local` 分支，每月 `git rebase origin/main`。
冲突只允许出现在 `mcp.ts` 与 `app.ts`；出现在别处说明越界了。

## 3. 三层结构

```
L2 接入面   /v1（OpenAI 兼容）  /mcp（Streamable HTTP）  快照图
                              │
L1 补丁层   list_models 加字段 · set_model_note · snapshot   ← fork 内，约 300 行
                              │
L0 数据面   freellmapi 路由/冷却/额度   CLIProxyAPI（订阅额度，可选）
```

### 3.1 补丁层只补三件事

| 需求 | 现状 | 补法 |
|---|---|---|
| 模型别名 + 回退链 | 已有 named chain 与 `fallback_config` | 不补 |
| 渠道健康与冷却 | 已有 `rate_limit_cooldowns` | 不补 |
| 免费额度池 | 已有 `provider_quota_state` | 不补 |
| 订阅账号转 API | 无 | 可选接 CLIProxyAPI |
| **Agent 看到价格、缺陷、额度** | 字段在库里，MCP 不返回 | 改 `listModels` |
| **Agent 写能力注解** | `quirks` 表已有，无写入工具 | 加 `set_model_note` |
| **额度快照成图** | 无 | 加 `snapshot` 路由 |

前四行借用，后三行补丁。

### 3.2 路由权只放一处

两层都做回退，会出现重试放大和状态不一致。分工固定为：

| 层 | 负责 | 不负责 |
|---|---|---|
| freellmapi 路由 | 一个模型 id 内部的多渠道链、冷却、额度闸门 | 跨模型 id |
| yonder `fallback` | 模型 id → 另一个模型 id，或直连内置 provider | 单个 id 内部 |

同一渠道失败**不重试**，直接下一个渠道。
yonder 侧 SDK 重试已为 0（07 §6.1），不叠加。

### 3.3 模型分层（2026-10-27 实现）

目录里的 `intelligence_rank` 是排名（越小越强），不能直接当分数用。
用主人自己的两个锚点校准：

| 锚点 | 排名 | 分数 |
|---|---|---|
| GLM-5.3 Max / Qwen3.8 Max | 17 | 45 |
| Qwen3.8 27B（low） | 39 | 26 |

区间内线性，区间外截断到 0–100。分层按分数切：

| 组 | 分数 | 排名 | 用途 |
|---|---|---|---|
| `main` 主力 | ≥45 | ≤17 | 常驻主 agent、长任务 |
| `agent` 代理主力 | 44 | 18 | 其他 agent 主模型 |
| `sub` 子代理 | 33–43 | 19–31 | sub agent、有验收标准的执行 |
| `util` 杂活 | 26–32 | 32–39 | 摘要、分类、改写 |
| `test` 试验 | <26 | ≥40 | 只测试，不接生产 |

免费池实测：`main` 1 个（qwen3.8-max），`agent` 0 个，`sub` 3 个，
`util` 7 个，其余 99 个是 `test`。**免费池撑不起「代理主力」这一档**，这是事实，不是配置问题。

`list_models` 返回 `tier`、`score`、`intel_rank`、`paid_price_per_m`、`quota`、
`quirks`、`notes`，并支持 `tier` 过滤。

## 4. 数据模型：全部复用，不建新表

`server/data/freeapi.db` 已有需要的全部结构：

| 需求 | 表 | 关键列 |
|---|---|---|
| 渠道与 key | `api_keys` | `platform`、`status`、`enabled`、`monthly_*_cap` |
| 模型目录 | `models` | `context_window`、`intelligence_rank`、`supports_tools`、`paid_input_per_m`、`monthly_token_budget` |
| 模型覆盖 | `model_overrides` | `overrides_json` |
| 已知缺陷 | `quirks` + `quirk_targets` | `slug`、`title`、`body`、`severity`、`model_glob` |
| 额度 | `provider_quota_state` | `limit_value`、`remaining_value`、`reset_at`、`source`、`confidence` |
| 月度用量 | `key_monthly_usage` | `requests`、`tokens` |
| 冷却 | `rate_limit_cooldowns` | `expires_at_ms`、`source` |
| 回退链 | `fallback_config` | `model_db_id`、`priority` |
| 请求审计 | `requests`、`request_attempts` | 逐次落点与 token |

注解写进 `local_model_notes`，不写 `quirks`：

```sql
local_model_notes(id, platform, model_glob, kind, body, updated_at_ms)
-- kind: best_for | avoid_for | caveats；platform 为空表示对所有渠道生效
```

原因：目录同步每次启动都会 `DELETE FROM quirks` 再灌入签名目录，
自写内容会被清掉。实测确认后改成独立表，重启后仍在。

不新增 `alias` 表：`fallback_config` 加模型 id 已经是别名语义，
`auto` 与 `auto:<strategy>` 已经是策略入口。再加一层别名只会让路由权分裂。

## 5. MCP 工具面

已有 9 个，`/mcp`，Streamable HTTP，统一 key 鉴权，2026-10-27 实测可用：

`ask_freellmapi` `healthcheck` `list_models` `provider_health` `usage_summary`
`routing_info` `set_routing_strategy` `cache_stats` `compression_stats`

要补 2 个：

| 工具 | 作用 | 权限 |
|---|---|---|
| `set_model_note` | 写 `quirks`，标注 best_for / avoid_for / caveats | 写 |
| `snapshot` | 额度与健康快照，出 SVG，可选转 PNG | 读 |

`list_models` 要加四个字段：`price`（每百万 token）、`quirks`、`quota_left`、`rank`。
现在只有 id、name、上下文、平台、工具支持。

风险提示：`set_routing_strategy` 已能改路由。写工具必须绑定 admin 能力，
readonly 会话只拿到读工具。这沿用 yonder「能力 + 级别」的单层判定，不新增审批。

## 6. 与 yonder 的接法

### 6.1 模型侧：只加一个 provider

已写入 `~/.local/share/yonder-harness/home/yonder.yaml`：

```yaml
models:
  providers:
    gw:
      baseUrl: http://127.0.0.1:3001/v1
      api: openai-completions
      authHeader: true
      models:
        - { id: qwen3.8-max, name: Qwen3.8 Max (free pool), contextWindow: 1000000, maxTokens: 65536 }
        - { id: gemini-3.8-flash, ... }
        - { id: gemini-3.7-flash, ... }
        - { id: qwen3.8-omni-flash, ... }
```

- 34 个上游**不**写进 `yonder.yaml`。yonder 只看见 4 个模型 id。
- 模型 id 用 freellmapi 的 id，不另起别名。别名一多，路由权就分裂。
- 换渠道、换 key、加免费渠道，yonder 无感，不需要重启。
- 凭据：`auth.json` 里加 `gw`，值取网关的统一 key。
  已核代码：`envApiKeyAuth` 的 `resolve` 先读 stored credential，再看 env。
  所以空 env 列表也能用存好的 key（`pi-ai/dist/auth/helpers.js:24`）。

### 6.1.1 统一回退链

15 个 fallback 块（5 个 agent 文件、10 个预设）全部改成同一条链：

```yaml
fallback:
  models:
    - gw/qwen3.8-max
    - gw/gemini-3.8-flash
    - gw/gemini-3.7-flash
    - gw/qwen3.8-omni-flash
    - rightapi-glm/glm-5.3-flash   # 原付费兜底，保留
  after: 3
```

主模型不动。只换回退目标。付费兜底放在最后，网关整体挂掉时仍能工作。
备份在同目录 `*.pre-gw-20261027`。

### 6.2 工具侧：复用现有 mcp-client

`docs/spec/14-execution-capabilities.md` 已支持 StreamableHTTP。
把 `http://127.0.0.1:3001/mcp` 配成一个 MCP 服务即可，不新写插件。

注意三点：
- MCP 用**统一 key** 鉴权，不是 dashboard session。实测用 session 会被拒。
- HTTP 传输需要 `network` 能力；readonly 会话不能因此越权。
- 工具名保留 `<pluginId>_<name>` 规则。

### 6.3 对账

freellmapi 在响应头返回 `x-routed-via`、`x-served-model`，并写 `requests` / `request_attempts`。
yonder 的 `pi.usage` 按 `gw/<model>` 记 token 与 cost。两边按请求时间与模型对账。

额度只有网关知道；单次成本只有 yonder 知道。两边都保留，不做单一事实源。

## 7. 快照

`snapshot` 的路径：

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
| FreeLLMAPI | Node + SQLite | 有，9 工具 | 策略 + 冷却 | 免费池额度 | 有 | MIT |
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

### 8.1 FreeLLMAPI 的已知代价（2026-10-27 实测）

- 磁盘 594 MB，其中 node_modules 459 MB、`.git` 20 MB。内存 RSS 114 MB。
- 默认监听 `[::]`，局域网可达。已用 `HOST=127.0.0.1` 收紧。
- 免费版模型目录比付费版晚 30 天。新免费模型不会当天出现。
- 上游更新快（近 30 天 20 个提交），自改代码要持续跟。
- 构建依赖 `better-sqlite3` 的 ABI：Node 22 加载失败，Node 24 正常。
  launchd 因此固定用 `mise lts` 的 Node 24，不用隔离运行时的 Node 22。
- 统一 key 以明文存在 `settings.unified_api_key`。库文件权限 0600，别再复制出去。

## 9. 免费额度：合规边界

- 订阅 OAuth 只能本机独立登录。**禁止**复制其他程序的 token（07 §6.2）。
- 免费渠道 429 如实返回，不伪装成成功（11 §1）。
- 网关不导出订阅 token，不把账号共享给非本机。
- 每个渠道的免费条款由使用者自己确认；网关只做技术聚合。

## 10. 分期

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 | 起 freellmapi，常驻 launchd，MCP 开启 | **已完成 2026-10-27** |
| P1 | fork `local` 分支：分层、价格、额度、缺陷、注解 | **已完成 2026-10-27** |
| P2 | yonder 接 `gw`，15 个回退块统一 | **已完成 2026-10-27** |
| P3 | 快照图（SVG/PNG） | 待做 |
| P4 | 扩渠道 | **部分完成**：cloudflare、cohere、groq 已接；mistral 免费档禁用 API key |
| P5 | 可选接 CLIProxyAPI，补订阅额度 | 待做 |

P3 之前不改 yonder 源码。P1 之前不改 freellmapi 源码。

## 11. 不做什么

- 不把网关塞进 yonder 内核或插件进程。理由：生命周期、崩溃隔离、其他客户端也要用。
- 不做多租户、充值、支付。
- 不做语义缓存（freellmapi 已有，先用它的）。
- 不做权重负载均衡。默认按链序，够用。
- 不改 `client/` 前端。现有 dashboard 够看额度与 key。
- 不写模拟渠道、假额度、示例数据。

## 12. 待维护者决定

1. 快照用 native 依赖换 PNG，还是只出 SVG？
2. 额度数据没有统一接口，多数只能估算。估算值是否允许写进 Agent 可见字段？
   若不允，`list_models` 的 `quota_left` 只能是 `unknown`。
3. 是否把 `local` 分支推到自己的远端，还是只留本地？
4. 是否重置 dashboard 密码（当前只有 1Password 里的旧密码可用）。

## 13. 未测项

- 未验证 yonder 自定义 provider 从 `auth.json` 取 key 的行为（已读代码，未实跑）。
- 未跑 `npm test`（4135 条）。
- 未测 `@resvg/resvg-js` 在 Node 24 的构建。
- 未接 CLIProxyAPI。
