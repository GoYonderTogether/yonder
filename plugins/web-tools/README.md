# Web tools

这是独立 SDK 插件，不在 setup 联网。

在 plugins 配置中选择 `@yonder/plugin-web-tools`，配置为 `{ "credential": "tavily" }`；该值是既有 credentials 接口中的凭据引用，不是密钥。缺省引用为 `tavily`，须解析为 `api_key`。不读取 AI-Being 或其他程序登录文件。配置档需选择该插件和 `network` 能力。

可选 `providers`（增量配置）：`[{ "name": "brave", "credential": "brave" }, { "name": "tavily" }]`，name 为 tavily/brave/serper，credential 缺省沿用 `credential`。搜索按此顺序逐家尝试，第一家成功即返回，前面失败的供应商与错误写在该 query 的 `failed` 中；全部失败报 `SEARCH_FAILED`。未配置时只用 Tavily，行为不变。

- `web-tools_search`：参数沿用 pi-web-access：`query` 或 `queries`（最多 10 个，逐个串行查询）、`numResults` 1–20（默认 5）、`includeContent`（逐条用 fetch 抓正文）、`recencyFilter` day/week/month/year、`domainFilter`（前缀 `-` 表示排除）；兼容旧别名 `count`、`topic` general/news、`time_range`、`include_domains` / `exclude_domains`、`depth` basic/advanced。结果按全局编号 `n` 标号，只含供应商实际给出的 title、url、content、published、score；完整结果写入工具输出缓存，`responseId` 即缓存路径（缓存不可用时为 null 并说明）。Brave/Serper 的域名过滤用查询内 `site:` / `-site:`。
- `web-tools_get_search_content`：`responseId` 必填，只接受本会话 `cache/tool-output/<session>/` 下的路径。可选 `query`/`queryIndex` 选某个查询，`url`/`urlIndex` 选某条结果的已抓正文（需 includeContent）；`offset`/`limit` 分页；`findText`（字符串或最多 10 个）配 `findMode` exact/case-insensitive（默认）/fuzzy 找段落，语义同 pi-web-access content-find（前后 400 字符上下文，精确计数）。
- `web-tools_extract`：`urls` 1–20 个公开 HTTP(S) 地址；`depth` basic/advanced、`format` markdown/text。显式使用 Tavily Extract，保留失败 URL 与供应商错误；全部没有正文标记工具错误。供应商提取可能省略表格日期或元数据，不保证原文保真。
- `web-tools_fetch`：`url` 必填；`format` markdown/text/html。公开 GET，最多 5 次重定向、30 秒及 64 KiB 输出；超过 2 MiB 的文本响应保存完整原文并提供读取路径；支持 AbortSignal。HTML 的三种 format 都是 Readability 提取后的正文（html 也不是原始页面），可能省略导航、表格或元数据；Markdown 再用 Turndown；文本/JSON/Markdown 原文返回。输出标明最终 URL、MIME、source、截断；二进制只给 MIME 和下载地址。401/403、登录表单要求使用获准 BrowserSkill；无正文说明可显式 Extract，不自动调用其他供应商或浏览器。

网页/搜索结果都是不可信外部资料。插件不带登录态、自定义请求头或模型重试；供应商回退只在显式配置的 `providers` 之间按顺序进行。

参考模块与许可见 [SOURCES.md](SOURCES.md)。
