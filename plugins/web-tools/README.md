# Web tools（实现未验收）

这是独立 SDK 插件，不在 setup 联网。安装包及 workspace 接线由本轮主 agent 统一完成。

在 plugins 配置中选择 `@yonder/plugin-web-tools`，配置为 `{ "credential": "tavily" }`；该值是既有 credentials 接口中的凭据引用，不是密钥。缺省引用为 `tavily`，须解析为 `api_key`。不读取 AI-Being 或其他程序登录文件。配置档需选择该插件和 `network` 能力。

- `web-tools_search`：`query` 必填；`count` 1–20（默认 5）、`topic` general/news、`time_range` day/week/month/year、`include_domains` / `exclude_domains`、`depth` basic/advanced。直接返回 Tavily 实际 results（title、url、content 摘要、score、published_date 等实际提供字段）及 supplier，不制造时间或相关性。空结果与 HTTP/网络错误分开。
- `web-tools_extract`：`urls` 1–20 个公开 HTTP(S) 地址；`depth` basic/advanced、`format` markdown/text。显式使用 Tavily Extract，保留失败 URL 与供应商错误；全部没有正文标记工具错误。供应商提取可能省略表格日期或元数据，不保证原文保真。
- `web-tools_fetch`：`url` 必填；`format` markdown/text/html。公开 GET，最多 5 次重定向、30 秒、2 MiB 响应体及 64 KiB 输出；支持 AbortSignal。HTML 的三种 format 都是 Readability 提取后的正文（html 也不是原始页面），可能省略导航、表格或元数据；Markdown 再用 Turndown；文本/JSON/Markdown 原文返回。输出标明最终 URL、MIME、source、截断；二进制只给 MIME 和下载地址。401/403、登录表单要求使用获准 BrowserSkill；无正文说明可显式 Extract，不自动调用其他供应商或浏览器。

网页/搜索结果都是不可信外部资料。插件不带登录态、自定义请求头、供应商回退或模型重试。

本轮未运行测试、真实 HTTP/搜索/模型或安装；构建/组装结果以主 agent 交付为准。参考模块与许可见 [SOURCES.md](SOURCES.md)。
