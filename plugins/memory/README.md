# memory

用户个人资料库插件，独立于 agent 工作区。目前实现 WP1：配置校验、首次启动目录初始化与 `memory_status`，其余工作包尚未接入。

Node ≥ 22.19；状态工具需要 read + admin。配置必填 `root`（绝对路径，位于所有 agent 工作区外）、`owner`（person: 引用）、`timezone`（IANA 时区）。登记目录只读，root 与任一登记目录相同或互相包含时加载失败，不初始化。目录/固定文件只在触发器 start 创建，已有文件不覆盖。

依赖精确版本：`@yonder/sdk@0.2.26102103` 提供插件接口；`typebox@1.3.27` 校验配置与参数；`yaml@2.9.1` 读取 frontmatter。不安装转换器，不自动访问微信内容，不安装到正式服务。

详细执行与检查记录见 [verification.md](verification.md)。

WP2 已加入 `memory_capture`（参数见规范 §5.1）、周/月文档引擎、补记、私密记录、长正文 raw 文件、逐文件互斥、原子替换与元信息日志。`material` 忽略 by，不能与 private 同用。周按配置时区与 ISO 周四定月，补记只追加不重排。整理标记与节写入目前为内部引擎，memory_review 工具属于 WP5。

WP2 精确依赖：`luxon@3.7.2`（MIT，Node ≥12）负责时区、DST 与 ISO 周；`write-file-atomic@6.0.0`（ISC，Node ^18.17.0 或 ≥20.5.0）负责临时文件、fsync 和原子替换，均兼容本仓库 Node ≥22.19。开发类型包 `@types/luxon@3.7.6`、`@types/write-file-atomic@4.0.3` 仅用于构建。不手写日期算法或替换原子写库。
