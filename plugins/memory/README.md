# memory

用户个人资料库插件，独立于 agent 工作区。目前实现 WP1：配置校验、首次启动目录初始化与 `memory_status`，其余工作包尚未接入。

Node ≥ 22.19；状态工具需要 read + admin。配置必填 `root`（绝对路径，位于所有 agent 工作区外）、`owner`（person: 引用）、`timezone`（IANA 时区）。登记目录只读，root 与任一登记目录相同或互相包含时加载失败，不初始化。目录/固定文件只在触发器 start 创建，已有文件不覆盖。

依赖精确版本：`@yonder/sdk@0.2.26102103` 提供插件接口；`typebox@1.3.27` 校验配置与参数；`yaml@2.9.1` 读取 frontmatter。不安装转换器，不自动访问微信内容，不安装到正式服务。

详细执行与检查记录见 [verification.md](verification.md)。
