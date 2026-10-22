# memory

用户个人资料库插件，独立于 agent 工作区。已实现 WP1–WP3：配置校验、首次启动目录初始化、`memory_status`、`memory_capture`、`memory_search` 与 `memory_read`。自动采集、inbox 转换、计划/整理工具、启动器 attention、上下文与 skills 属于 WP4–WP7，尚未接入。

Node ≥ 22.19；状态工具需要 read + admin。配置必填 `root`（绝对路径，位于所有 agent 工作区外）、`owner`（person: 引用）、`timezone`（IANA 时区）。登记目录只读，root 与任一登记目录相同或互相包含时加载失败，不初始化。目录/固定文件只在触发器 start 创建，已有文件不覆盖。

依赖精确版本：`@yonder/sdk@0.2.26102103` 提供插件接口；`typebox@1.3.27` 校验配置与参数；`yaml@2.9.1` 读取 frontmatter。不安装转换器，不自动访问微信内容，不安装到正式服务。

详细执行与检查记录见 [verification.md](verification.md)。

WP2 已加入 `memory_capture`（参数见规范 §5.1）、周/月文档引擎、补记、私密记录、长正文 raw 文件、逐文件互斥、原子替换与元信息日志。`material` 忽略 by，不能与 private 同用。周按配置时区与 ISO 周四定月，补记只追加不重排。整理标记与节写入目前为内部引擎，memory_review 工具属于 WP5。

WP2 精确依赖：`luxon@3.7.2`（MIT，Node ≥12）负责时区、DST 与 ISO 周；`write-file-atomic@6.0.0`（ISC，Node ^18.17.0 或 ≥20.5.0）负责临时文件、fsync 和原子替换，均兼容本仓库 Node ≥22.19。开发类型包 `@types/luxon@3.7.6`、`@types/write-file-atomic@4.0.3` 仅用于构建。不手写日期算法或替换原子写库。


WP3 使用 PATH 中的 `rg`，固定字面/忽略大小写/不跟随链接参数，不经 shell。查询同时搜索用户输入与其 NFKC 形式，按文件聚合并按逐命中的来源与日期过滤；不改写已有兼容字符原文。默认搜索 timeline/life/me/mine/raw/projects 和登记目录，不含 archive/private；private 与 frontmatter 私密文件需显式 includePrivate。登记目录路径写作 `<name>:<相对路径>`，只读；memory_read 也可按 ISO 周定位，并分页返回至多 12000 字符。缺 rg 给出诊断，不提供另一套检索实现。

测试仅使用临时文件系统；尚未在用户 Obsidian/微信归档、真实模型或正式服务验证。卸载配置不会删除根目录。根 package-lock.json 未在本任务允许的修改范围内更新，全新 npm ci 安装新 workspace 未验收。

WP4 已接入主人白名单消息与 inbox：chokidar@5.0.0（MIT，Node ≥20.19）awaitWriteFinish 1000ms；周期重扫兜底。点文件和下载临时文件不处理；转换失败留在 inbox 并在 status 报错。文本原件不添加 frontmatter，manifest 的 files[path].origin 是其权威来源，hashes[sha256] 指原件路径；keys 保存事件/微信等去重引用，不含正文。附件使用随机前缀文件名避免冲突。转换文件为原件路径加 .converted.md，写 origin/source/sha256/converted，并做 NFKC。推荐外部 markitdown 0.1.9（MIT），插件不负责安装。
