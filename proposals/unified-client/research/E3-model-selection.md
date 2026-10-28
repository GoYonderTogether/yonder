> 证据材料，结论已并入 [agent-parity.md](../agent-parity.md)

# Yonder 自主选模型：数据源与机制调研（E3）

## 范围与口径

- 问题：让 Agent 按成本、速度、智能水平、任务偏好与特长，把规划 / 设计 / 执行 / 杂活四类子任务分派给不同模型。数据必须来自公开、可自动更新的源，不能写死某个人临时给的价目。
- 调研时间 2026-10-27，全部数字为本机实测（macOS，经本机代理）。联网命令统一写作 `~/.local/bin/agent-network run -- curl -sS --max-time 60 <url> | head -c 4000`；统计类命令另注。
- 只读调研：本文件是新增报告，未改动 `packages/`、`docs/spec/` 或任何既有文件。凡涉及 `docs/spec/` 的改动都只是提案，需维护者批准。
- 「智能分」「速度」没有单一权威源，报告把它们拆成可获取的信号，并区分「公开源」与「本地实测」。

## 1 结论速览

1. **价格与能力（上下文、模态、工具调用、推理级别）用 models.dev 一个源就够**。`https://models.dev/api.json` 无 key、MIT、字段最全，而且 **pi-ai 的模型目录本来就是从它生成的**（`node_modules/@earendil-works/pi-ai/scripts/generate-models.ts`，产物 `dist/providers/data/<provider>.json`），Yonder 已经在间接使用；再引入第二套目录只会制造 id 与价格分歧。
2. **OpenRouter `/api/v1/models` 与 LiteLLM 的 json 只作校验/兜底**：前者覆盖 463 条「Yonder 真能通过 OpenRouter 调到的模型」，且带 `supported_parameters`；后者 4324 条，带 `supports_function_calling`/`supported_endpoints`/`deprecation_date`，适合补齐 models.dev 缺的端点与弃用信息。
3. **智能分用 LMArena 的 HuggingFace 榜单数据集**（`lmarena-ai/leaderboard-dataset`，cc-by-4.0，每日更新，`latest`/`full` 两个 split，且**按竞技场分 subset**：text / agent / search / vision / document），这是唯一「按任务类型 + 可编程 + 许可清晰」的人类偏好分。
4. **「任务类型 → 现实里大家用什么」用 OpenRouter `task-spend` 前端接口**（`/api/frontend/v1/rankings/task-spend`，无 key，29 个细粒度 task tag，每个 tag 给前 10 名模型的份额与变化）。这正好是 OpenRouter Auto Router 的选型信号，可当 Yonder 的冷启动先验。
5. **速度没有免费可再分发的公开源**：OpenRouter 目录与 rankings 都没有延迟/吞吐字段；Artificial Analysis 有 `median_output_tokens_per_second` 但要 key、必须署名、再分发需签约。→ 速度以**本地实测**为主（Yonder 已有按 `provider/modelId` 的 usage 与 run 计时），公开源只做冷启动。
6. **Artificial Analysis 不进默认链**：`/api/v2/language/models/free` 实测仍 401，免费层 100 请求/24h，条款要求署名、禁止再分发。
7. **LiveBench 目前不可靠**：榜单是 SPA，数据从 `./data/<release>/table.csv` 取，实测该路径（含 `2026-06-25`）全部 404；HF 上 livebench 组织只有题库与判定数据，没有榜单分数。→ 列为可选源，失败不阻塞。
8. **Yonder 现在完全不看成本/智能/速度**：选模型 = 配置里的 `model` + `fallback` 链，加失败/额度驱动的**链重排**（`model-chain.ts` / `model-gate.ts` / `model-watch.ts`）。任务类型→模型只有「子会话预设里写死 model」一条路。本报告给的是在链首加一层「打分选型」的最小方案，不改降级机制。

## 2 数据源对比表

| # | 源 | 主要字段 | 实测覆盖 | 更新 | 访问 / key | license / 条款 | 稳定性 | 建议用途 |
|---|---|---|---|---|---|---|---|---|
| 1 | models.dev `api.json` | cost（含 cache_read/write、tiers、context_over_200k）、limit{context,output}、modalities、tool_call、structured_output、reasoning + reasoning_options、release_date、last_updated、open_weights、canonical_model_id | 5,955,090 字节；**232 provider / 8944 model**；有价 8544、reasoning 6822、tool_call 7867 | 每日（仓库 pushed 2026-10-27T17:29Z） | `GET https://models.dev/api.json`，**无 key** | 仓库 `github.com/anomalyco/models.dev` **MIT**，7419 stars；无 SLA/速率承诺 | 高（静态 JSON、体量大、无鉴权） | **价格与能力主源** |
| 2 | OpenRouter `/api/v1/models` | pricing{prompt,completion,input_cache_read,write,overrides}、context_length、top_provider{context_length,max_completion_tokens}、architecture.modality、supported_parameters、reasoning{supported_efforts}、knowledge_cutoff、expiration_date | **463 条** | 随模型上下线（分钟级） | 无 key | OpenRouter 服务条款；无显式数据许可 | 高（正式 API） | 只对「走 OpenRouter 的模型」校验价格/参数 |
| 3 | OpenRouter rankings 前端 API | `/rankings/models`：tokens/requests/tool_calls/requests_with_tool_call_errors；`/rankings/task-spend`：29 个 task tag × 前 10 模型 × share + deltaPp；`/rankings/apps`（含 app.categories）、`/rankings/tools`、`/rankings/images` | models 664 条；task-spend 29 tag（30 天窗口） | 每日 | 无 key，`/api/frontend/v1/...` | 无公开许可，属内部前端接口 | 中（前端接口会变；`?category=` 参数被静默忽略） | **任务类型偏好先验** |
| 4 | LiteLLM `model_prices_and_context_window.json` | input/output_cost_per_token、max_input/output_tokens、supports_function_calling/tool_choice/vision/reasoning/prompt_caching、supported_endpoints、supported_modalities、deprecation_date、source | 2,960,307 字节；**4324 条** | 每日 | raw.githubusercontent，无 key | 仓库 MIT（`enterprise/` 目录另行商业许可） | 高 | 交叉校验 + 端点/弃用兜底 |
| 5 | LMArena（arena.ai） | Elo/BT rating、rank、category | 网页；直连 `/api/leaderboard` → 301 → **403 Cloudflare** | — | 需浏览器 | — | 低（反爬） | 不用 |
| 6 | LMArena HF 数据集 `lmarena-ai/leaderboard-dataset` | model_name、rating、rank、category、leaderboard_publish_date；subset：text / text_style_control / vision / search / agent / document / image_edit / image_to_video，及 agent_bash_reliability、agent_tool_hallucination、agent_steerability、agent_multi_step 等 | parquet，`latest` + `full` | 每日（lastModified 2026-10-27T03:02Z） | HF datasets / parquet 直链，无 key | **cc-by-4.0**（需署名） | 高 | **智能分（含分任务）主源** |
| 7 | Artificial Analysis | intelligence index、median_output_tokens_per_second、price/1M、GPQA/HLE/LiveCodeBench/τ²-Bench/Terminal-Bench、TTFT、分位数（Pro） | Free 层仍 **401 需 key** | 持续 | `x-api-key`；Free 100 req/24h | 全层**必须署名**；再分发/转售需签合同 | 中（旧路径 `deprecation`，sunset 2026-11-04） | 可选增强（用户显式开启） |
| 8 | LiveBench | 分任务分数（reasoning/coding/math/data_analysis/IF/language） | SPA，`./data/<release>/table.csv` **404** | 约每季 | 无 API | Apache-2.0（LICENSE 文本） | 低 | 可选，不阻塞 |
| 9 | Aider polyglot | pass_rate_1/2、percent_cases_well_formed、edit_format | YAML 单文件 | 人工提交（低频） | raw.githubusercontent，无 key | 仓库 Apache-2.0 | 高（但慢） | 编码执行类的硬指标 |
| 10 | SWE-bench | 每实例 resolved + cost、instance_cost、per_instance_details | 内嵌 JSON（2.39MB 页面） | 随提交 | 抓 `swebench.com` HTML | 榜单页无许可；`SWE-bench/experiments` 仓库 **无 LICENSE** | 中 | 编码执行类参考，不外发 |

## 3 逐个数据源说明

### 3.1 models.dev（api.json）

- 访问：`~/.local/bin/agent-network run -- curl -sS --max-time 60 https://models.dev/api.json | head -c 4000`，无 key、无分页、单文件全量。
- provider 字段：`id, env, npm, api, name, doc, models`；model 字段：`id, name, description, family, attachment, reasoning, reasoning_options[{type:"effort",values[]}], tool_call, structured_output, temperature, knowledge, release_date, last_updated, modalities{input,output}, open_weights, limit{context,output}, cost{input,output,cache_read,cache_write,tiers,context_over_200k,input_audio,reasoning,output_audio}, canonical_model_id`。
- 实测 cost 键出现次数：`input`/`output` 8544、`cache_read` 6222、`cache_write` 1989、`tiers` 808、`context_over_200k` 626、`input_audio` 202、`reasoning` 155、`output_audio` 24 —— **长上下文分段价只有 808 条有**，做成本估算时要按 `limit.context` 判断是否需要 tier 价。
- 更新频率：仓库每日多次提交（pushed 2026-10-27T17:29Z），JSON 无 `Last-Modified` 语义承诺，只能靠内容 hash 或模型级 `last_updated` 判断新鲜度。
- 许可：MIT（`github.com/anomalyco/models.dev`；站点页脚同时链到 `sst/models.dev`，后者 API 返回 404，以 anomalyco 为准）。
- 稳定性：无鉴权、无速率限制，也没有 SLA；单文件近 6MB，适合每天拉一次 + 本地裁剪。

### 3.2 OpenRouter `/api/v1/models` 与 rankings

- 目录：`GET https://openrouter.ai/api/v1/models`，无 key，实测 463 条。价格是**每 token 的美元字符串**（`pricing.prompt` / `pricing.completion` / `input_cache_read` / `input_cache_write`，另有 `overrides[{min_prompt_tokens,...}]` 分段）。`supported_parameters` 里能直接读出 `tools`、`tool_choice`、`reasoning_effort`、`structured_outputs` 等能力位；`reasoning.supported_efforts` 给出可用的思考档。**没有任何延迟/吞吐字段。**
- rankings 前端接口（都无 key、都返回 JSON）：
  - `/api/frontend/v1/rankings/models` —— 664 条，按模型给 `total_prompt_tokens`/`total_completion_tokens`/`count`/`total_tool_calls`/`requests_with_tool_call_errors`/`rankingMetricValue` 等。
  - `/api/frontend/v1/rankings/task-spend` —— **关键**：`data.spend{windowDays:30, macroCategories[{key,label,spendShare}], tasks[{tag,macroCategory,spendShareOfTotal,models[{model,share,deltaPp}]}]}`，`data.tokens` 同构。实测 29 个 tag：`agent:workflow_execution`(0.203)、`classification_tagging`(0.118)、`code:general_impl`(0.094)、`agent:multi_step_planning`(0.075)、`data:extraction`(0.073)、`code:file_read_write`(0.045)、`code:debugging`(0.043)、`roleplay_fiction`(0.039)、`content_writing`(0.039)、`qa_knowledge`(0.035)、`data:transformation`(0.030)、`code:review_security`(0.028)、`code:shell_execution`(0.023)、`conversational_reply`(0.023)、`code:frontend_ui`(0.015)、`research_report`(0.015)、`agent:tool_dispatch`(0.013)、`customer_support`(0.013)、`summarization`(0.012)、`agent:web_search`(0.011)、`code:repo_scan`(0.010)、`security_audit`(0.009)、`math`(0.009)、`agent:memory_extraction`(0.005)、`code:devops_config`(0.005)、`finance_trading`(0.004)、`code:sql_database`(0.004)、`translation`(0.004)、`devops`(0.003)。
  - `/api/frontend/v1/rankings/apps`（app 带 `categories`，如 `["cli-agent","personal-agent"]`）、`/rankings/tools`、`/rankings/images`。
- **陷阱**：`/rankings/models?category=programming`、`?dimension=domain` 等参数被**静默忽略**（返回与不带参数完全相同的数据，bogus 值也 200），不要把它们当分类过滤用；分类只在 `task-spend` 与 `apps` 里。
- 许可：OpenRouter 服务条款，未给数据再分发许可 → 只本地缓存 + 界面署名链接。
- 稳定性：`/api/v1/` 是正式接口；`/api/frontend/v1/` 是前端内部接口，字段可能变，解析要容错。

### 3.3 LiteLLM `model_prices_and_context_window.json`

- `GET https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json`，无 key，实测 2,960,307 字节 / 4324 条（含 `sample_spec` 自描述条目）。
- 字段频次（实测）：`litellm_provider` 4323、`mode` 4315、`input_cost_per_token` 3490、`output_cost_per_token` 3482、`max_input_tokens` 3472、`max_output_tokens` 3220、`source` 3015、`supports_function_calling` 2546、`supports_tool_choice` 2140、`supports_vision` 1976、`supports_reasoning` 1660、`supports_response_schema` 1599、`cache_read_input_token_cost` 1582、`supports_prompt_caching` 1250、`supported_endpoints` 1173、`deprecation_date` 875、`supported_modalities` 607、`supports_web_search` 428、`supports_xhigh_reasoning_effort` 300、`supports_max_reasoning_effort` 221。
- 许可：仓库 MIT（`enterprise/` 目录另行商业许可，LICENSE 首段明示）；API 报 NOASSERTION 是因为这个双许可结构。
- 用途：models.dev 缺 `supports_endpoints` / `deprecation_date` 这类字段；LiteLLM 是补齐与交叉校验的最佳来源，不建议当主源（键名是 provider 自定义的 litellm 命名，跟 Yonder 的 `provider/modelId` 不一致）。

### 3.4 Artificial Analysis（可选）

- `GET https://artificialanalysis.ai/api/v2/data/llms/models` → **401 `{"error":"API key is required"}`**，并带 `deprecation`/`sunset: Wed, 04 Nov 2026 23:59:59 GMT`。新路径 `/api/v2/language/models`（Pro/Commercial）、`/api/v2/language/models/free`（Free），实测 free 仍 **401**。
- 层级：Free = 语言模型列表（headline index、median performance、输入输出价）+ 免费媒体端点，**100 请求/24h 固定窗口**（登录 MCP 翻倍 200）；Pro = 模型级端点、完整定价、分位数；Commercial = provider 级、时间序列、原始测量。响应头 `X-AA-Tier`、`X-RateLimit-*`，429 带 `Retry-After`；鉴权 `x-api-key`。
- 字段形态：`{"slug","name","model_creator":{"name"},"evaluations":{"artificial_analysis_intelligence_index":57.6},"pricing":{"price_1m_input_tokens","price_1m_output_tokens"},"performance":{"median_output_tokens_per_second":98.29}}`；Pro 另含 GPQA/HLE/SciCode/IFBench/MMLU-Pro/AIME/LiveCodeBench/τ²-Bench/Terminal-Bench/AA-Omniscience/GDPval-AA 与 TTFT。
- 条款：**所有层级都必须署名**（可见 byline 或页脚链接回 artificialanalysis.ai）；再分发/转售需联系销售签合同。→ 只在用户显式开启时拉取，不进默认数据链，也不随产品分发。

### 3.5 LMArena

- 直取失败：`https://lmarena.ai/api/leaderboard` → 301 到 `https://arena.ai/api/leaderboard` → **403 Cloudflare「Just a moment...」**（非浏览器 UA 被拦）。
- 可用路径：HuggingFace `lmarena-ai/leaderboard-dataset`，**cc-by-4.0**，lastModified 2026-10-27T03:02Z（每日级），parquet，`latest`（当前榜）与 `full`（历史快照）两个 split；每个竞技场一个 subset：`text`、`text_style_control`、`vision`、`vision_style_control`、`search`、`search_style_control`、`agent`、`document`、`document_style_control`、`image_edit`、`image_to_video`，以及 `agent_bash_reliability`、`agent_bash_reliability_no_prereq`、`agent_bash_recovery_steps`、`agent_tool_hallucination`、`agent_steerability`、`agent_multi_step`、`agent_praise_complaint`、`agent_task_outcome_explicit` 等细分。
- 列：`model_name, rating, rank, category, leaderboard_publish_date`（README 示例 `filters=[("category","==","overall")]`）。
- 用法：`agent` / `text` / `search` / `document` 四个 subset 的 `rating` 直接当「按任务类型的智能分」；`agent_tool_hallucination`、`agent_bash_reliability` 可当「执行类子任务的可靠性标签」。

### 3.6 LiveBench（暂不可用）

- 站点是 React SPA（`main.4228bafc.js`），数据按 `fetch('./data/' + release + '/table.csv')`、`categories.json`、`cost.csv`、`breakdown.json`、`notes.json` 加载。
- 实测 `https://livebench.ai/data/2026-06-25/table.csv`、`/data/2026-09-10/`、`/data/2026-10-18/`、`/static/data/...`、`/2.0/data/...` **全部 404（GitHub Pages "Page not found"）**；bundle 里的 release id 列表止于 `2026-06-25`（v1）与另一组 v2 id，页面标注 "25 October 2026"。
- HF 上 `livebench/*` 只有题库/答案/判定数据集，无榜单分数；`livebench/LiveBench` dataset 访问报 "Invalid username or password"。
- 许可：LICENSE 文本是 Apache-2.0（复制自 lm-sys/FastChat）。结论：只能浏览器抓 SPA，稳定性差 → 可选源，抓不到就跳过。

### 3.7 Aider polyglot

- `GET https://raw.githubusercontent.com/Aider-AI/aider/main/aider/website/_data/polyglot_leaderboard.yml`，无 key，200；字段 `dirname, test_cases, model, edit_format, commit_hash, pass_rate_1, pass_rate_2, pass_num_1, pass_num_2, percent_cases_well_formed, error_outputs, num_malformed_responses`。
- 仓库 Apache-2.0；更新靠人工提交（低频），适合当「代码执行类」的慢变量硬指标。

### 3.8 SWE-bench

- `swebench.com` 是静态页，榜单数据内嵌在 `<script type="application/json" id="leaderboard-data">`：`[{name:"Multilingual", results:[{agent, agent_org, cost, date, folder, instance_calls, instance_cost, model_display, model_org, os_model, per_instance_details{instance:{api_calls,cost,resolved}}}]}]` —— 直接带**每实例成本与 resolved**，可解析。
- 原始提交在 `github.com/SWE-bench/experiments`：`evaluation/{lite,verified,multilingual,multimodal,test}/<submission>/{metadata.yaml, results/{results.json,file_f1.json,patch_stats.json,resolved_by_repo.json}}`；`results.json` 只有实例清单（`no_generation/generated/with_logs/install_fail/reset_failed`），通过率要自己按 `metadata.yaml` 算。
- **仓库无 LICENSE** → 只做本地参考，不外发、不再分发。

## 4 pi 现有能力（模型注册表从哪来）

- `pi-ai`（`node_modules/@earendil-works/pi-ai`，version 1.3.0）的模型数据**就是从 models.dev 生成的**：`scripts/generate-models.ts`（`package.json` 的 `"generate-models": "node scripts/generate-models.ts --strict"`），产物 `dist/models.generated.js`（只 import 各 provider）+ `dist/providers/<id>.models.js` + `dist/providers/data/<id>.json`（真实数据）。
- 字段（`dist/types.d.ts:672-709`）：`BaseModel{id,name,api,provider,baseUrl,input:ModelInputModality[],inputLimits?,cost:ModelCost,headers?}`；`Model` 追加 `reasoning:boolean`、`thinkingLevelMap?`、`promptCache?`、`contextWindow:number`、`maxTokens:number`、`samplingParams?`、`compat?`。`ModelCost` 在 `dist/providers/model-schema.d.ts`（`input/output/cacheRead/cacheWrite` + `tiers[{inputTokensAbove,input,output,...}]`）。
- **有 cost / contextWindow / reasoning；没有速度分、没有智能分，也没有独立的 `toolCall` 布尔**（工具能力由 `api` 协议隐含）。
- 目录刷新按 provider 定制：`dist/providers/openrouter.js` 的 `personalizeOpenRouterCatalog(catalog, context)` 调 `GET {baseUrl}/models/user`（Bearer key；401/403/404 时原样返回内置目录），用 `top_provider.context_length || entry.context_length`、`top_provider.max_completion_tokens`、`openRouterCost(entry.pricing)` 覆盖 `contextWindow`/`maxTokens`/`cost`。`models-store.js` 有 `ModelsStore` 与 `ModelsRefreshOptions{allowNetwork,providers,force,signal}` —— 说明「持久化目录 + 可刷新」在 pi 侧已有先例。
- `pi --list-models` 实测输出（本机，未配 key 也能列已配置 provider）表头为 `provider  model  context  max-out  thinking  images`，例如：

  ```
  rightapi-claude  claude-opus-5-5       200K  64K   yes  yes
  rightapi-sol     gpt-6.1-sol           272K  128K  yes  yes
  workbuddy        deepseek-v4.1-flash   1M    128K  yes  yes
  ```

  **没有价格列，也没有 JSON 输出选项**（`docs/cli.md:73`：`--list-models [search]`，模糊搜索后退出）。要给 Agent 看价格，只能自己读 pi-ai 的 `Model.cost` 或自己维护目录。

## 5 Yonder 现状（代码级）

选模型今天是「静态配置 + 失败/额度驱动的链重排」，没有任何成本/智能/速度/任务类型感知：

| 环节 | 位置 | 行为 |
|---|---|---|
| 配置 | `packages/core/src/config/schema.ts:14-48` | `SessionModelsSchema`：`credentialSlots`、`model`（`^[^/]+/.+$`）、`thinking`（off/minimal/low/medium/high/xhigh/max）、`fallback{models[],accounts{},accountModels{},after,quotaStopPercent,hold,probe}` |
| 展链 | `packages/core/src/runtime/model-chain.ts` | `modelChain(model, fallback, selection): ChainEntry[]`：主模型 → `fallback.models[0]` → accounts 别名 `<provider>#<slot>` → 其余 models；`chainKey = ${base}/${modelId}@${slot}`；`DEFAULT_FALLBACK_AFTER=3`、`DEFAULT_MODEL_HOLD_SECONDS=600`、`DEFAULT_MODEL_PROBE_SECONDS=60`、`MIN_MODEL_PROBE_SECONDS=15`；`accountModels` 只允许同 provider 换模型 |
| 排序 | `packages/core/src/runtime/model-gate.ts` | `ModelGate.blocked(entry,stops)` / `order(chain,stops)`：健康持有或额度超线只把条目**移到链尾**，不改配置顺序 |
| 健康 | `packages/core/src/runtime/model-watch.ts` | `record()`：`run.status==="error"` 且 reason 匹配 `/^(model_error|no_model)\b/` 则整链 hold；以非链首完成则 hold 前面的条目（`fallback-used`）。`probe()` 每 15s 起，`probeOne()` 发 `maxTokens:512` 单轮 ping，成功即清除持有 |
| 起点 | `packages/core/src/runtime/index.ts:740-770` | `const chain = this.watch.order(modelChain(profile.model, profile.fallback, profile.credentialSlots), profile.fallback?.quotaStopPercent); const primary = chain[0] ?? splitModelRef(profile.model);` 其余条目变成 pi 原生 `modelFallbacks{models,after}`，再 `conversation.configure({model, modelFallbacks, thinkingLevel, extensions, tools, modelTools, instructions, cwd})` |
| 状态 | `packages/core/src/runtime/index.ts:800+` | `modelStatus(id)` 返回 `{model:{provider,id,contextWindow,maxTokens}, thinking, primary, fallback, failures, running, contextTokens, compact, tasks[]}`；`configureModels(id, models)` 可改会话级 models |
| 用量 | `packages/pi-durable/src/harness/usage.ts` | `UsageState = {models: Record<"provider/modelId", Usage>, tools: Record<toolName, Usage>}`；`addUsage()` 累加 input/output/cacheRead/cacheWrite/totalTokens/reasoning 与 `cost.input/output/cacheRead/cacheWrite/total`。`packages/core/src/runtime/index.ts:1211` 汇总 `sum.cost += usage.cost.total` |
| 任务类型 | `docs/spec/03-agents.md:112`、`plugins/agent-presets/src/index.ts:18,48` | 子会话 `contexts/model/thinking/fallback/credentialSlots/instructions` **由预设决定**，不继承父会话；现存预设全部写死 `model: "openai/gpt-6-luna"` |

要点：

- **已有真实花费实测**（按目录价算出的 `cost`），但**没有延迟/吞吐实测**，也没有「每个任务类型花了多少」的聚合。
- `packages/core/src/routing/` 是**消息路由**（channel→session），与模型选择无关。
- 模型目录来源：`packages/core/src/runtime/auth.ts:47` `buildModels(slots.defaults, config.models?.providers)`；覆盖逻辑在 `packages/core/src/runtime/models.ts:122-130`（`yonder.yaml` 的 `modelOverrides` 可按模型改 `contextWindow`/`cost` 等）。
- 相关的既有设计：`docs/spec/07-runtime.md:80`（模型健康与冷却，`<home>/.yonder/model-health.json`，0600）、`07:82`（官方用量窗口 `model-quota.json`，5 小时窗口 + `quotaStopPercent`）。**改这两处属于设计变更，需维护者批准。**

## 6 推荐组合

| 维度 | 主源 | 补源 | 本地实测 |
|---|---|---|---|
| 价格 | models.dev（含 cache/tier/长上下文分段） | OpenRouter `/api/v1/models`（走 OpenRouter 的模型）、LiteLLM（`deprecation_date`、端点） | `pi.usage` 的 `cost.*` 累计，按 `provider/modelId` 校准「目录价 vs 实际账单」 |
| 能力（上下文/模态/工具/推理档） | models.dev | OpenRouter `supported_parameters`、LiteLLM `supports_*` | 失败原因（`model_error`/`no_model`）与 `thinkingLevelMap` 命中情况 |
| 智能 | LMArena HF `latest`（text/agent/search/document 分任务） | SWE-bench（执行类）、Aider polyglot（代码类） | 任务成功率（`run.end` 状态 × 任务类型） |
| 任务偏好 | OpenRouter `task-spend`（29 tag 的份额与 deltaPp） | LMArena `agent_*` 细分（工具幻觉、可操纵性） | 用户显式 pin / 否决 |
| 速度 | **无公开免费源** | Artificial Analysis（可选、需 key、需署名） | run 计时 → 每模型 p50/p90 端到端耗时、每任务 token 数 |

### 6.1 本地缓存与刷新

- 落盘位置：`<home>/.yonder/model-catalog/`（与 `model-health.json`、`model-quota.json` 同级，原子写、0600）：
  - `catalog.json` —— 从 models.dev 裁剪后的模型档案（见 §7），只保留「本机可达」的 provider + 排行榜前 N 名模型，避免 6MB 全量进内存。
  - `rankings/lmarena-<subset>.json`、`rankings/openrouter-task-spend.json`、`rankings/swebench.json`、`rankings/aider-polyglot.yml`。
  - `local-stats.json` —— 按 `(taskType, provider/modelId)` 累计的成功率、p50 耗时、平均 token、实际成本。
  - `meta.json` —— 每源 `{url, etag/last-modified, fetchedAt, contentHash, schemaVersion, ok/error}`；**抓取失败保留旧文件并记录 `age`**，不阻塞运行。
- 刷新节奏：启动后延迟 30s 一次（抖动 ±10s，避免多实例同秒打同一源），之后 catalog 每 24h、LMArena 每 24h、task-spend 每 24h、SWE-bench/Aider 每 7d、AA 仅手动或用户开启后每 24h。全部走后台，失败只写日志与 `meta.json`。
- 离线优先：`catalog.json` 缺失时**回退 pi-ai 内置目录**（已有 `cost`/`contextWindow`/`reasoning`），选型降级为「只按上下文/能力过滤 + 现有链序」。
- 与 pi 的关系：不替换 pi-ai 的模型目录（那是运行时真实调用所需），只在其上叠一层「评分/标签」；两者用 `provider/modelId` 对齐，`models.dev.canonical_model_id` 与 OpenRouter `canonical_slug` 用来做跨源归一。

## 7 模型档案 schema 草案

```jsonc
{
  "id": "openai/gpt-6-luna",              // provider/modelId，Yonder 内部唯一键
  "provider": "openai",
  "aliases": ["openrouter/openai/gpt-6-luna", "litellm:gpt-6-luna"],
  "catalog": {
    "contextWindow": 272000,
    "maxOutput": 128000,
    "modalities": { "input": ["text", "image"], "output": ["text"] },
    "toolCall": true,
    "reasoning": { "supported": true, "levels": ["minimal", "low", "medium", "high"] },
    "releaseDate": "2026-09-03",
    "deprecationDate": null,
    "source": "models.dev",
    "observedAt": "2026-10-27T17:29:00Z"
  },
  "cost": {
    "unit": "usd_per_mtok",
    "input": 1.0, "output": 5.0,
    "cacheRead": 0.1, "cacheWrite": 1.25,
    "tiers": [{ "inputTokensAbove": 200000, "input": 2.0, "output": 10.0 }],
    "source": "models.dev",
    "observedAt": "2026-10-27T17:29:00Z"
  },
  "scores": {
    "intelligence": {
      "overall": 0.91,                    // 归一化到 0..1（同源分位数，不是绝对值）
      "byTask": { "planning": 0.93, "design": 0.88, "execute": 0.90, "chore": 0.71 },
      "source": "lmarena:leaderboard-dataset@latest",
      "observedAt": "2026-10-27T03:02:00Z",
      "confidence": "high"
    },
    "speed": {
      "outputTps": 98.3, "ttftMs": 620,   // 公开先验；本地实测优先覆盖
      "source": "artificialanalysis:free", "confidence": "low"
    },
    "coding": { "swebenchResolved": 0.71, "aiderPolyglot": 0.83, "source": "swebench+swebench.com" }
  },
  "tags": ["long-context", "tool-reliable", "cheap-output", "agent-arena-top"],
  "preference": {
    "marketShareByTask": { "agent:workflow_execution": 0.213, "code:debugging": 0.041 },
    "source": "openrouter:task-spend", "observedAt": "2026-10-27T00:00:00Z"
  },
  "local": {
    "measured": {
      "runs": 37, "successRate": 0.92,
      "p50LatencyMs": 8400, "avgTokensPerTask": 41200,
      "avgCostPerTaskUsd": 0.062,       // 来自 pi.usage 的 cost.total
      "lastAt": "2026-10-27T16:20:00Z"
    },
    "override": { "pin": false, "ban": false, "weightBoost": 0.0, "note": "用户手动调整" }
  },
  "freshness": { "staleAfterHours": 48, "conflicts": ["litellm:max_input_tokens 与 models.dev 不一致"] }
}
```

规则：

- **每个数值都带 `source` + `observedAt`**；缺失就写 `null` 并标 `confidence: "none"`，**不写 0**（0 价会污染成本排序）。
- 合并优先级：`local.override` > `local.measured` > 公开源；公开源内部 models.dev > OpenRouter > LiteLLM（价），LMArena > AA > 其他（智能）。
- 跨源 id 用 `aliases` 收敛；解析不出来就保留两条档案并记 `conflicts`，不做猜测性合并。

## 8 Agent 自主选择机制草案

### 8.1 两种形态

**A. 上下文注入（先做，改动最小）**：在系统提示的固定段落里注入一张小表（≤ 15 行 / ≤ 800 token），内容是「当前可用模型 × 关键维度」，只列通过硬约束的候选：

```
可用模型（价格=美元/百万 token，智能=0..1 归一化，速度=本地 p50 端到端秒）
provider/model            ctx    in/out  intel  speed  tags            实测(成功/成本/耗时)
openai/gpt-6-luna         272K   1.0/5.0  0.91   8.4s   long-context    92%  $0.062  8.4s
anthropic/claude-opus-5.5 200K   3.0/15.0 0.94   11s    tool-reliable   95%  $0.180  11.2s
deepseek/v4.1-flash       1M     0.1/0.4  0.72   3.1s   cheap           88%  $0.006  3.1s
任务类型参考：planning/design→intel 权重高；execute→intel+可靠性；chore→cost 权重最高
```

Agent 通过**现有**机制落地选择：给子会话预设写 `model`，或直接在主会话里按需 `task_run` 到对应预设。**不新增路由层**，先验证「Agent 会不会按数据选对」。

**B. 工具化（后续）**：新增 `model_list`（返回候选 JSON）与 `task_run` 的 `model` 参数（受白名单 + 预算 + 能力交集约束），或一个 `model_route({taskType, needContext, needTools, budgetUsd})` 工具返回 `{model, reason, alternatives}`。选型结果必须落审计记录（`pi.model-attempt` 已有位置可扩展），便于事后核对。

### 8.2 选型规则怎么由数据推出来

1. **任务类型判定**：词表直接用 OpenRouter 的 29 个 tag（外部维护、覆盖面够），映射到 Yonder 四类：
   - 规划 = `agent:multi_step_planning`、`agent:workflow_execution`
   - 设计 = `code:frontend_ui`、`content_writing`、`research_report`
   - 执行 = `code:general_impl`、`code:debugging`、`code:file_read_write`、`code:shell_execution`、`code:repo_scan`、`code:sql_database`、`code:devops_config`、`security_audit`
   - 杂活 = `classification_tagging`、`summarization`、`translation`、`data:extraction`、`data:transformation`、`conversational_reply`
2. **硬约束过滤**（先砍，不打分）：`contextWindow ≥ 估计上下文 × 1.3`；`toolCall` 必须为真（执行类）；模态匹配（有图就必须 `input` 含 `image`）；`reasoning.levels` 覆盖所需 `thinking`；provider 有可用凭据槽；不在 health hold / quota 超线名单里。
3. **打分**：`score = w_i · intelligence_norm(task) + w_s · speed_norm − w_c · cost_norm(task)`。
   - `cost_norm` 用**本任务的估计花费**（估计输入 token × 输入价 + 估计输出 token × 输出价，含 cache 价与 tier 价），再用全体候选的分位数归一化，避免绝对价格被少数极贵模型拉爆量纲。
   - 权重按任务类型给（初值即可，后续用本地实测调）：规划 `{i:0.6, s:0.1, c:0.3}`、设计 `{i:0.55, s:0.15, c:0.3}`、执行 `{i:0.45, s:0.2, c:0.35}`、杂活 `{i:0.15, s:0.25, c:0.6}`。
   - `intelligence_norm(task)` 优先用 LMArena 对应 subset（agent/text/search/document）的 rating 分位数；缺该模型时退到 `overall`，再缺退到 `task-spend` 份额的分位数（**份额当偏好先验，不当能力**）。
4. **平局与缺数据**：`local.measured.runs ≥ 5` 时用本地成功率/耗时覆盖公开分；样本不足时公开分优先，且**保守降权**（乘 0.9）避免新模型靠先验冲顶。
5. **只决定链首**：选型输出一个有序候选列表，`chain[0]` 是选中的模型，`chain[1..]` 按同一打分排序；**`model-chain`/`model-gate`/`model-watch` 的降级与探测逻辑完全不变**。这样即使选型逻辑出错，行为也退化成今天的样子。
6. **反馈闭环**：`run.end` 已有 usage + 模型 + 耗时 → 写 `local-stats.json` 的 `(taskType, model)` 桶；每 N 次运行重算一次权重（简单的网格/坐标上升即可，不上 ML）。

### 8.3 与现有 spec 的关系（提案，不是改动）

- `docs/spec/03-agents.md:88-89` 的 `model` / `fallback` 语义不变；新增的是「`model` 可以由选型结果填」，以及可选的 `modelPolicy` 配置（权重、预算、白名单、pin/ban）。
- `docs/spec/07-runtime.md:80/82` 的健康与额度机制不动，选型只在其**之前**执行（被 hold 的条目直接不进候选）。
- 需要维护者决定的三点：① 选型是否允许跨 provider（涉及凭据与预算）；② 是否允许 Agent 在运行中改模型（现在只允许在链内切）；③ 选型是否默认开启。

## 9 风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 目录错价/缺价 | 8944 条里 8544 条有价；`tiers` 只有 808 条、`context_over_200k` 626 条 → 长上下文成本容易被低估；0 价既可能是真免费也可能是缺数据 | 0 价单独标 `confidence:"none"`；超 200K 上下文时若无 tier 价按「缺价」处理并要求 pin |
| 跨源 id 对不齐 | models.dev `id`、OpenRouter `canonical_slug`、LiteLLM 键、LMArena `model_name` 命名体系不同（LMArena 常带日期后缀） | `aliases` + `canonical_model_id`，对不上就保留两条并记 `conflicts`，绝不猜 |
| 排行榜偏差 | LMArena 是人类偏好（≠ 工具调用/长任务能力）；`task-spend` 是市场惯性（滞后、受营销影响）；SWE-bench 是「agent + harness」组合成绩，不是模型单项 | 智能分只做**排序先验**，最终以本地实测为准；执行类额外要求 `toolCall` 与 `agent_*` 可靠性标签 |
| 速度数据缺位 | 没有免费可再分发的吞吐/TTFT 源 | 速度主用本地实测；AA 只在用户开启时作为冷启动 |
| 条款 | AA 必须署名、禁再分发；SWE-bench experiments 无 LICENSE；LMArena cc-by-4.0 需署名；OpenRouter 前端接口无数据许可 | 只本地缓存；产品界面给来源链接与署名；不打包再分发原始数据 |
| 接口漂移 | `/api/frontend/v1/...` 无版本承诺，参数被静默忽略（`?category=` 已实测无效）；LiveBench 数据路径 404 | 解析容错 + 每源 `schemaVersion` + 失败保留旧数据；LiveBench 只做可选 |
| 成本失控 | Agent 自主选贵模型、或反复试错 | 预算上限（每任务/每日）、`costTier` 上限、审计记录、`pin` 覆盖 |
| 不可复现 | 同任务不同模型、目录每天变 → 结果不可比较 | 选型结果与当时档案快照（`contentHash`）一起落 `pi.model-attempt`，可回溯 |
| 与 pi 目录双份真相 | 自建 catalog 与 pi-ai 内置目录可能不一致（pi 更新滞后或 `modelOverrides` 覆盖） | 以 pi 运行时实际 `Model` 为准（`getModel()`），自建档案只补 `cost`/`scores` 之外的评分维度；差异写 `conflicts` |

## 10 附：本次实测命令与关键结果

```sh
# models.dev
curl -sS https://models.dev/api.json            # 5,955,090 B；232 provider / 8944 model；MIT
# OpenRouter 目录
curl -sS https://openrouter.ai/api/v1/models    # 463 条；pricing 每 token 字符串；无速度字段
# OpenRouter 任务分类份额（关键）
curl -sS https://openrouter.ai/api/frontend/v1/rankings/task-spend   # 29 tag × top10，windowDays=30
curl -sS "https://openrouter.ai/api/frontend/v1/rankings/models?category=programming"  # 与无参数完全相同 → 参数被忽略
# LiteLLM
curl -sS https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json  # 2,960,307 B / 4324 条
# Artificial Analysis（需 key）
curl -sS https://artificialanalysis.ai/api/v2/language/models/free    # 401 API key is required
# LMArena：直连被 Cloudflare 拦，走 HF
curl -sS https://lmarena.ai/api/leaderboard     # 301 → arena.ai → 403 "Just a moment..."
curl -sS https://huggingface.co/api/datasets/lmarena-ai/leaderboard-dataset   # license cc-by-4.0，lastModified 2026-10-27
# LiveBench：SPA 数据路径全部 404
curl -sS https://livebench.ai/data/2026-06-25/table.csv   # 404
# Aider polyglot
curl -sS https://raw.githubusercontent.com/Aider-AI/aider/main/aider/website/_data/polyglot_leaderboard.yml  # 200
# SWE-bench：榜单数据内嵌在 HTML 的 <script id="leaderboard-data">
curl -sS https://www.swebench.com/ | grep -o 'leaderboard-data'   # 命中；含 per_instance_details{resolved,cost}
```
