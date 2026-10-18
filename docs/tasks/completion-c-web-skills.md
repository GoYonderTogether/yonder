# C lane：Web tools → Skills 本地管理

状态：实现未验收。基线 C0 446ea49，独立工作树 completion-web-skills；仅修改 lane 允许路径。

## Web tools 结果

新增独立 SDK 包 `plugins/web-tools/`：Tavily Search/Extract、公开 HTTP GET、Readability 正文、Markdown/text/html 输出、最终 URL/MIME/供应商字段、有界读取/输出、取消/30 秒超时、5 次重定向、HTTP/登录/JS 与二进制诊断。无供应商自动回退、模型重试或浏览器接管。凭据只走 credentials.get，供应商输出与错误擦除密钥。

来源 commit/模块/许可与配置及参数见插件 README/SOURCES。包内精确声明依赖，根 workspace/lock/项目引用/发行许可由主 agent 接线。

## Skills 结果

复用原发现、frontmatter、workspace > home > plugin 优先级、profile 通配、遮蔽与 skill_view 路径校验；保留模型只能读取已选择 skill。新增管理 show 可查看未选用 skill，返回实际胜出内容、来源、选用和同名遮蔽信息。pluginSources 为实际目录到 plugin id 的映射，缺映射显示 plugin:unknown，目录不再冒充 id。

导出 `addLocalSkill(source: string, target: LocalSkillsTarget)` / `removeLocalSkill(name: string, target: LocalSkillsTarget)`，其中 target 为 `{ home: string; workspace?: string }`，均返回 Promise。调用方必须先解析 agent 并确认 local 执行环境。导入复制真实 SKILL.md 与普通附属文件，源中符号链接/特殊文件拒绝并说明，不触及导入来源；按 frontmatter name 建直接目标目录，已有目录拒绝。删除仅允许管理根的同名直接目录且 frontmatter name 匹配，不接受符号链接；嵌套链接由 fs.rm 删除链接自身而非目标。无注册表、Hub、自动学习或启停数据库。

`createSkills(...).show(session: RuntimeSessionConfig, name: string)` 返回 `{ skill, shadowed, content }`；session 沿用现有 agent/profile 解析；content 复用 skill_view 的绝对目录和位置头。保留 `inspect/index/view` 签名。createSkills 增加可选 `pluginSources?: ReadonlyMap<string,string>`，pluginDirs 保留。

## 验证与问题

- 按授权未新增、修改或运行测试；未运行模型、HTTP/搜索、浏览器、安装或桌面操作。
- 独立工作树未安装 node_modules。Web 使用临时 tsconfig 映射主仓 SDK/Node 类型和 AI-Being 已装提取库类型，strict/noEmit 独立检查通过；未改变仓库编译配置。Skills 同法检查因缺 yaml/typebox/pi/chord 依赖未通过，未标为成功。根项目 build/typecheck 交主 agent 统一组装。
- CLI/control、插件目录映射、根依赖与公共导出由主 agent 接线；本 lane 不修改 loader/kernel/SDK/CLI/根文件。
- 真实 Tavily、中文/时效/域限制、GET/JS/login/取消矩阵及管理实际运行，全部未测，留下一轮。

## 注册接线修正

主 agent 组装发现清单短名与实际注册全名不一致。对照 SDK `checkRegistrations` 的原规则（逐项比较实际 tool.name 与清单，不自动加前缀），已将 web-tools 清单改为 `web-tools_search`、`web-tools_extract`、`web-tools_fetch`。仅源码核对与清单修正，未运行测试或外部调用。
