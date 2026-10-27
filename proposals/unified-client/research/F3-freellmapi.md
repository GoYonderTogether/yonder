## 一、结论速览

- **服务在运行**：`127.0.0.1:3001`（不是 48765/8000/18787），OpenAI 兼容 `/v1`，单端口同时承载 dashboard。
- **可用性良好**：`/readyz` 报告 13 个上游就绪；`/v1/models` 返回 295 条统一模型，其中 **80 条同时满足 context ≥ 100k 且支持工具调用**。
- **实测 3 个模型都能正确返回 `tool_calls`**：`qwen3.8-27b`（Groq，1.7s）、`dots3-note-preview`（OpenRouter，12.0s）、`gemini-3.5-flash-lite`（Google，26.3s）。
- **最适合 Yonder 真实测试的组合**：`qwen3.8-27b`（快、262k、tools、无中转成本）+ `gemini-3.5-flash-lite`（1M ctx、tools）+ `dots3-note-preview`（512k、OpenRouter 带 `cached_tokens` 字段，唯一能观测 prompt-cache 的路径）。
- **最大限制**：网关自身限流 120 req/min/IP；上游各家免费额度极小（OpenRouter 全账号 50 req/天、Google 20 req/天）；`google/gemini-3.8-flash` 近 3 天 28 次失败，不可作为稳定基线。

---

## 二、项目是什么

仓库：`/Users/zoran/Documents/github/freellmapi`（上游 `tashfeenahmed/freellmapi`，MIT）。

定位：把多个免费 provider（34 个渠道 / 635 个免费 endpoint）聚合成**一个** OpenAI 兼容端点。路由器按实时速度、能力、可靠性打分选模型；遇到 429/5xx 自动 fallback、冷却、key 轮换。provider key 用 AES-256-GCM 加密存 SQLite；模型目录从 `freellmapi.co` 拉签名目录（免费版走 monthly 快照，比 live 目录落后约 300 个模型）。

关键点：它**不是**本地推理，是**转发代理 + 路由**。所有请求都发往真实第三方（Groq、Google AI Studio、OpenRouter、Cloudflare、Cohere、OVH 等）。

### 启动与运行

| 项 | 值 |
|---|---|
| 进程 | `node /Users/zoran/Documents/github/freellmapi/server/dist/index.js`（PID 44131） |
| 端口 | `127.0.0.1:3001` |
| 启动 | `node server/dist/index.js` |
| 停止 | `kill "$(cat .run/server.pid)"` |
| PID / 日志 | `.run/server.pid` / `.run/server.log` |
| 状态库 | `server/data/freeapi.db`（SQLite） |
| 开发模式 | `npm install && npm run dev`（server:3001 + dashboard:5173） |
| 健康检查 | `GET /livez` → `{"status":"ok","version":"0.4.1"}`；`GET /readyz` → `{"status":"ok","ready_upstreams":13}` |

**端口辨析**（本机四个监听里只有一个是对的）：

- `3001` → **freellmapi**（dashboard 与 `/v1` 同端口）
- `48765` → c2c.js（codex-with-chatgpt）
- `18787` → billion-context
- `8000` → laya-serve
- 另有 `8788`（Docker，WorkBuddy 网关）、`5173`（Vite 开发）

注意：服务默认监听 `[::]`，**局域网可达**；想收紧在 `.env` 里设 `HOST=127.0.0.1`。

### API 形态

- 主面：`/v1/chat/completions`、`/v1/responses`、`/v1/completions`、`/v1/embeddings`、`/v1/models`、`/v1/images/generations`、`/v1/audio/speech` 等。
- 旁路协议：Anthropic wire `/v1/messages`、Gemini `/v1beta`、可选 Ollama 仿真（`/api/tags`、`/api/chat`，settings `ollama_emulation=key-required`）、MCP `/mcp`。
- 路由诊断响应头：`X-Routed-Via: <platform>/<model>`、`X-Served-Model`、`X-Fallback-Trail`。
- 网关限流头：`X-RateLimit-Limit: 120`、`X-RateLimit-Remaining`、`X-RateLimit-Reset`（`server/src/middleware/rateLimit.ts:60`，按 IP 每分钟 120 次）。
- **鉴权**：单一 bearer token，`Authorization: Bearer <统一 key>`。key 名 `unified_api_key`（settings 表），本机落在 `.run/unified-api-key.txt`，也在 1Password Agent-Automation vault 的 `FreeLLMAPI unified API key` 条目里（`agent-op item get` 免桌面授权）。
- ⚠️ 安全观察：**统一 key 在 `settings` 表是明文**（provider key 才加密）。这是已知的本地风险，不影响远程，但备份 `server/data/freeapi.db` 等于备份明文 key。

### 当前启用的渠道（13 条 healthy）

aihorde / kilo / ovh / google(aistudio) / openrouter / zhipu / llm7 / custom=Pollinations / custom=LM Studio(local) / xkiro / agnes / cohere / cloudflare / groq。

已禁用：github（假阳性，任意 token 都 200）、ollama（推理 401）；custom=WorkBuddy intl 状态 invalid。
**所有 key 都没配代理**（`api_keys.proxy_encrypted` 全为 null），流量直连上游。

---

## 三、模型清单

`GET /v1/models` 共 **295** 条（`auto`、`fusion`、`auto:<strategy>` + 各统一模型 id）。字段：

```
id, name, context_window, context_length, available,
unavailable_reason, execution_status, supported_parameters
```

- `supported_parameters` 含 `tools` / `tool_choice` / `parallel_tool_calls` → 支持 function calling；`stream` 普遍存在，**没有独立的"是否流式"字段**。
- 过滤：`?available=true`（别名 `connected` / `ready`）、`?execution_status=ready|needsKey|exhausted`（实时可打性）。
- 统一 id 已跨 provider 合并（同模型多 provider 折叠成一个 id，组内严格 failover）。
- **重要**：统一 id **不含 `/`**（如 `qwen3.8-27b`，不是 `groq/qwen/qwen3.8-27b`）。这对 Yonder 的 `provider/model` 解析很关键。

可用模型上下文分布（`available=true`）：1M 26 个、512k 1 个、262k 30 个、256k 5 个、200k 2 个、131k 31 个、128k 5 个、≤32k 26 个、null 20 个。

### ≥100k 上下文 + 支持工具调用（80 个中的精选）

| 统一 id | ctx | 上游 | 备注 |
|---|---|---|---|
| `gemini-3.5-flash-lite` | 1M | google | 实测通过，26s（冷启动慢） |
| `gemini-3.8-flash` | 1M | google | 近 3 天 28 次失败，**不稳定** |
| `gemini-2.5-flash` / `-lite` | 1M | google | 路由链头名 |
| `gemini-3-flash-preview` / `3.1-flash-lite` / `3.5-flash` / `3.6-flash` / `3.7-flash` | 1M | google | 同渠道共享 rpm 10–15 / rpd 20 |
| `qwen3.8-27b` | 262k | groq + cloudflare | **实测 1.7s，首选** |
| `gpt-oss-120b` | 131k | groq + cloudflare + ovh | groq rpd 1000 / tpm 8000 |
| `gpt-oss-20b` | 131k | groq + cloudflare + ovh | 同上 |
| `dots3-note-preview` | 512k | openrouter + kilo | **唯一返回 `cached_tokens`**，实测 12s |
| `nemotron-3.5-lightning` | 1M | kilo + openrouter | 1M 里最便宜的免费项 |
| `qwen3-coder-plus` | 1M | xkiro | 1M tokens/天 |
| `north-mini-code` | 256k | cohere + kilo | code 专用 |
| `agnes-2.5-flash` | 262k | agnes | vision |
| `mistral-medium-3.5` / `mistral-large-2512` / `devstral-medium` | 262k | xkiro | |
| `Qwen3.5-397B-A17B` / `Qwen3.5-9B` / `Qwen3.8-27B` | 262k | ovh | **2 req/min per IP，很紧** |
| `llama-4-scout-17b-16e-instruct` | 131k | cloudflare | |
| `command-a-plus-05-2026` / `command-a-reasoning-08-2025` | 256k | cohere | rpd 33 |
| `deepseek-v4.1-flash` | 1M | custom(Pollinations) | 近期最活跃，77 成功 |

不在表内的其他候选：cloudflare 的 `glm-4.7-flash`、`qwq-32b`、`qwen3-30b-a3b-fp8`、`llama-3.1-8b-fp8`、`mistral-small-3.1-24b`；xkiro 的 `qwen3.7-max`、`qwen3.8-max`、`qwen3-vl-plus`；cohere 的 `command-a-03-2025`、`command-r-plus-08-2024`、`command-r7b-arabic`；llm7 的 `mistral-Nemo-Instruct-2407`（128k）。

---

## 四、实测（共 8 次请求，含 1 次失败重试）

请求体统一为一个 tool 定义（`get_weather(city)`，`tool_choice: "auto"`）+ 一句 "What is the weather in Paris? Use the tool."，`max_tokens: 200`。

### 1. `qwen3.8-27b`（Groq）— 推荐基线

```
http=200  total=1.745836s
X-Routed-Via: groq/qwen/qwen3.8-27b
tool_calls[0].function = {"name":"get_weather","arguments":"{\"city\":\"Paris\"}"}
finish_reason = tool_calls
usage = {prompt_tokens:281, completion_tokens:26, total_tokens:307,
         queue_time:0.0487, prompt_time:0.0198, completion_time:0.0673, total_time:0.0871}
```

工具调用格式完全正确；usage 带 Groq 的 `queue_time/prompt_time/completion_time`，**无 `cached_tokens`**。

### 2. `dots3-note-preview`（OpenRouter）

```
http=200  total=12.028026s
X-Routed-Via: openrouter/dots-studio/dots-3-note-preview:free
tool_calls[0].function = {"name":"get_weather","arguments":"{\"city\": \"Paris\"}"}
finish_reason = tool_calls
usage = {prompt_tokens:178, completion_tokens:56, total_tokens:234, cost:0, is_byok:false,
         prompt_tokens_details:{cached_tokens:0, cache_write_tokens:0},
         cost_details:{upstream_inference_cost:0},
         completion_tokens_details:{reasoning_tokens:32}}
```

**唯一能观测 `cached_tokens` 的路径**（OpenRouter 原样透传）。12s 延迟偏慢，`reasoning_tokens: 32` 说明它是思考型模型。

### 3. `gemini-3.5-flash-lite`（Google AI Studio）

```
http=200  total=26.324008s
X-Routed-Via: google/gemini-3.5-flash-lite
tool_calls[0].function = {"name":"get_weather","arguments":"{\"city\":\"Paris\"}"}
tool_calls[0].thought_signature = "EmAKXgFpFH0TJ5edS1fl..."   ← Gemini 思考签名
usage = {prompt_tokens:55, completion_tokens:16, total_tokens:71}
```

工具调用正确，但 **26s**，且响应带 `thought_signature`（Gemini 特有的思维链签名，pi-ai 透传即可，不影响解析）。usage 只有三字段。

### 4. 流式验证（`qwen3.8-27b` + `stream_options.include_usage`）

```
HTTP/1.1 200 OK
Content-Type: text/event-stream
X-Routed-Via: groq/qwen/qwen3.8-27b
最后一个 chunk: choices:[] , usage:{prompt_tokens:15, completion_tokens:3, total_tokens:18, ...}
data: [DONE]
```

流式 + usage 都正常。但注意：**`time_starttransfer` 与 `time_total` 几乎相等（10.87s / 10.87s）**，说明首个 SSE 帧到达前有一段较长等待——不适合把"首 token 延迟"当指标来测，只适合测总时长。

### 5. 失败样本

`gemini-3.8-flash` 首次请求直接 HTTP 503（上游不可用），与 DB 里近 3 天 28 次 error 一致。**不要拿它做基线。**

---

## 五、怎么接入

### A. `~/.pi/agent/models.json`

```json
{
  "providers": {
    "freellmapi": {
      "baseUrl": "http://127.0.0.1:3001/v1",
      "api": "openai-completions",
      "apiKey": "$FREELMAPI_API_KEY",
      "models": [
        {
          "id": "qwen3.8-27b",
          "name": "Qwen3.8 27B (freellmapi/groq)",
          "contextWindow": 262144,
          "maxTokens": 32768,
          "input": ["text", "image"],
          "reasoning": false
        },
        {
          "id": "gemini-3.5-flash-lite",
          "name": "Gemini 3.5 Flash Lite (freellmapi/google)",
          "contextWindow": 1048576,
          "maxTokens": 65536,
          "input": ["text", "image"],
          "reasoning": false
        },
        {
          "id": "dots3-note-preview",
          "name": "Dots3 Note Preview (freellmapi/openrouter)",
          "contextWindow": 512000,
          "maxTokens": 32768,
          "input": ["text"],
          "reasoning": true
        }
      ]
    }
  }
}
```

- **只写 `$FREELMAPI_API_KEY` 引用**，真值放环境变量或 pi 的 `auth.json`（`{"freellmapi": {"type":"api_key","key":"…"}}`）。`models.json` 支持 `$NAME` / `${NAME}` 插值、字面值、`!command`，命令在请求时执行、不缓存。
- 若要复用 pi 内置 provider 的模型定义、只改出口，可只写 `baseUrl`（如 `{"openai": {"baseUrl": "http://127.0.0.1:3001/v1"}}`），但那样会把 OAuth token 发给本机网关，**不推荐**。
- `api: "openai-completions"` 是正确选择；不要用 `openai-responses`，虽然网关有 `/v1/responses`，但 fallback 链是按 chat completions 优化的。

### B. Yonder 里怎么指定

Yonder 用 pi-ai 的 `provider/modelId` 字符串，解析在 `packages/core/src/config/index.ts`（profile `model` 字段默认 `"openai/gpt-6-luna"`），运行时在 `packages/core/src/runtime/model-watch.ts` / `model-chain.ts` 里按**第一个 `/`** 切分。

**1. 在 `yonder.yaml` 加 provider（`YonderSchema.models.providers`，`packages/core/src/config/schema.ts:127`）**

```yaml
schema: 1
models:
  providers:
    freellmapi:
      baseUrl: http://127.0.0.1:3001/v1
      api: openai-completions
      models:
        - id: qwen3.8-27b
          name: Qwen3.8 27B
          contextWindow: 262144
          maxTokens: 32768
          input: [text, image]
        - id: gemini-3.5-flash-lite
          name: Gemini 3.5 Flash Lite
          contextWindow: 1048576
          maxTokens: 65536
          input: [text, image]
```

⚠️ Yonder 的 `ProviderConfigSchema` **没有 `apiKey` 字段**（只有 `name/baseUrl/api/headers/compat/authHeader/models/modelOverrides`），且 `packages/core/src/runtime/model-watch.ts` 对未知 provider 用 `envApiKeyAuth(id, [])`——**env 变量列表为空**，所以 key 只能来自凭据库：

```sh
yonder login freellmapi --method api_key      # 写入 .yonder/auth.json
```

或手工在 `.yonder/auth.json` 里加一条 `"freellmapi": {"type":"api_key","key":"…"}`（文件已是 `0600`，`credentials.ts` 的 `FileAuthStorageBackend` 加 lockfile 保护）。**key 不进 yaml、不进 git。**

**2. profile 指定模型**

```yaml
profiles:
  answer:
    model: freellmapi/qwen3.8-27b
```

或运行时切：`yonder chat` 里 `/model freellmapi/qwen3.8-27b`。

**3. 用 `YONDER_TEST_REAL` 跑现有真实用例**

`CONTRIBUTING.md:81-87` 的说明：

> 默认测试不调用模型。需要模型的用例用真实模型 `openai/gpt-6-luna`，显式启用 `YONDER_TEST_REAL=1 npm test`。凭据路径取环境变量 `YONDER_TEST_AUTH`，默认 `<仓库>/.yonder/auth.json`（已被 `.gitignore` 忽略）。

现实约束：真实用例的 profile 模型**硬编码** `openai/gpt-6-luna`（`packages/core/src/tools/sources.test.ts:117`、`effort.test.ts:55`、`tasks.test.ts:50`、`runtime/fallback.test.ts:134`），且测试 config 是内联字面量 `{ schema: 1, credentials: auth }`（见 `runtime/credential-slot-loopback.test.ts:39` 的模式），**不带 `models.providers`**。所以有两条路：

- **路 A（推荐，零改动）**：不走 vitest，用 CLI/运行时手动跑 —— `YONDER_TEST_AUTH` 指向一个只含 `freellmapi` 条目的临时 auth 文件，profile 写 `freellmapi/qwen3.8-27b`，手工记录 agent 行为、压缩、缓存指标。
- **路 B（要改测试，属于代码改动）**：给真实用例的 config 字面量加 `models: { providers: { freellmapi: { baseUrl: "http://127.0.0.1:3001/v1" } } }`，并把 `model` 换成 `freellmapi/…`。改动很小但要改多个文件，本次只读调研不动。

**4. 长上下文与压缩测试的注意点**

- 不要用 `gemini-3.8-flash`（28 次失败）。用 `qwen3.8-27b`（262k）测中等长度，`gemini-3.5-flash-lite`（1M）测超长，但单次 1M 请求会撞 Google 的 tpm 250k 与 rpd 20，**建议先测 100k–150k**。
- Yonder 的 `config.compaction.reserveTokens` 依赖 `models.getModel(...).contextWindow`（见 `runtime/fallback.test.ts:186`），所以 `models.json` / yaml 里的 `contextWindow` 必须填真实值，否则压缩触发点算错。
- **缓存命中测试**：网关的响应缓存**默认关闭**，但可以用请求头**逐请求开启**——`X-FreeLLM-Cache: on` 会绕过全局开关（`server/src/services/cache.ts:141` `cacheActive`），命中返回 `X-FreeLLM-Cache: HIT` + `X-Routed-Via: cache`，且**不消耗上游配额**。这正好用来测"同 prompt 二次调用"的命中率，不需要改服务配置。TTL 默认 3600s，temperature 默认上限 1.0。pi-ai 的 `openai-completions` 支持自定义 header，Yonder 的 provider config 也有 `headers` 字段可以挂上去。
- 上游真正的 prompt-cache（`cached_tokens`）只有 OpenRouter 路径能看到，其他 provider 的 usage 是原样透传，多数不给这个字段。

---

## 六、风险

1. **上游稳定性是最大变量**。近 3 天数据：`google/gemini-3.8-flash` 28 次 error、`gemini-3.7-flash` 10 次 canceled、`custom/deepseek-v4.1-flash` 14 次 error。免费额度 + 免费队列意味着**延迟和可用性都不可控**（实测 1.7s 到 26s，跨度 15 倍）。做 A/B 提示词对比时，模型选择波动会污染结果——必须固定 `X-Routed-Via` 或直接锁定统一 id，并记录每次实际路由到的上游。
2. **配额极小且随时变**。OpenRouter 全账号 50 req/天、Google rpd 20、Cohere rpd 33、OVH 2 req/min per IP。一次"新旧提示词对比 × 3 模型 × 5 用例"就可能把 OpenRouter 打空。`provider_quota_state` 里 kilo/openrouter/zhipu/llm7/xkiro 都有过 `rate limited` 记录。
3. **内容会转发给第三方**。这是代理，不是本地推理：prompt 会完整发到 Groq / Google / OpenRouter / Cloudflare / Cohere 等。**测试里绝对不能放真实秘密、真实用户数据、内部路径或 token**。用构造的假数据。
4. **条款**。各上游的免费层普遍禁止转售/批量抓取，且多数会**用免费请求训练模型**（Google AI Studio 免费层、OpenRouter 的 `:free` 变体明确如此）。评估性测试没问题，但别把生产数据走这条路。
5. **本机暴露面**。服务默认监听 `[::]`，局域网可达，鉴权只有单一 bearer token；统一 key 在 `settings` 表是明文。建议设 `HOST=127.0.0.1`，并确保 `.run/unified-api-key.txt` 与 `server/data/freeapi.db` 不进任何备份到云端的目录。
6. **`auto` / `fusion` 不适合做可复现实验**。`auto` 按实时评分选模型，同一请求两次可能落到不同上游；`fusion` 会并行发多个子请求（消耗多份配额）。测试请显式指定统一 id。

---

## 七、未验证 / 待确认

- **没有实测 100k+ 的真实长 prompt**（受配额与 tpm 限制，本次只发了最小请求）。"262k / 1M 上下文能否真的吃下 100k token"目前只有目录声明，**未取得运行时证据**。
- **没有实测响应缓存命中**（本次未发 `X-FreeLLM-Cache: on` 的重复请求）。
- **没有实测并行工具调用**（`parallel_tool_calls` 在 `supported_parameters` 里，但只验证了单 tool_call）。
- **`.env` 未读取**（被 CC Safety Net 规则 `secret.basename.env` 拦截），所以 `HOST`、`RESPONSE_CACHE` 等实际生效值未确认，只从 `settings` 表与代码默认值推断。
- **`google/gemini-3.8-flash` 的 28 次失败**只从 DB 统计看到，未查具体 error body。