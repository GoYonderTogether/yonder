# V03 第二轮：个人页阻塞

- 基线 `c81bbf02d4b99ee96a39ba6e6c7053e14733bfbe`：个人页 `Me` 初始化调用 `httpApi.session()`；默认 `VITE_SOCIAL_BASE` 为空，携带 cookie 请求同源 `GET /api/session`。请求失败进入“加载资料失败 / 重试”，只有成功返回 `null` 才显示社交登录。
- 正式 gateway 在登录后仅处理 `/api/rpc/*` 等已定义接口，其他 `/api/*` 返回 404；没有社交代理。云端实际 `GET /api/session` 返回 web 会话对应的 actor 或 null，`PATCH /api/me` 更新资料；云端区分 web 和 device 会话，设备凭据不能直接当作 web 人类会话使用。
- `design.md` §3.2、R4 将本机网关社交代理及用户态凭据列为未核实设计；现有 `contracts.md` 未定义该代理。要让本机 gateway 个人资料、登录和更新真实可用，需先确定用户会话与代理契约，涉及 contracts.md，按任务要求停止；不能将 gateway 404 当作未登录或使用假资料。
- 核对了基线与当前源码、云端认证实现及第二轮验收记录；未启动 gateway 或复验云登录，未执行 `migrate --apply`，未修改产品代码。当前 main 和工作区存在并行改动，已偏离基线。
