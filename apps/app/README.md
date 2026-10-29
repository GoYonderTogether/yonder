# @yonder/app（名片网页）

数据源由构建时的 `VITE_API` 决定，见 `src/api/index.ts:5`：

- 未设 / 其他值 → 内存 mock（`src/api/mock.ts`）。页面照常发码、登录、新建 Bot、聊天，但全是本地假数据，并显示「本地原型模式」横幅。**只用于界面原型与本机预览。**
- `VITE_API=http` → 真实接口（`src/api/http.ts`），同源 `/api`；需要换源时再设 `VITE_SOCIAL_BASE`。

## 生产/云端构建

```sh
cd apps/app && npm run build:web
```

等价于 `VITE_API=http YONDER_APP_BASE=/ npm run build` 后跑 `node scripts/check-build-api.mjs`：

- `VITE_API=http`：真实接口。漏掉它就是 mock 构建（2026-10-29 云端网页事故，JV2-J01-01）。
- `YONDER_APP_BASE=/`：资源绝对路径，云端站点挂在域名根；网关托管（`/console/`）与桌面壳用默认 `./`，不要用本命令。
- `check-build-api.mjs`：产物里带「本地原型模式」「（原型回复）」文案，或找不到 `/auth/code/verify`、`/me/default-bot` 调用点，就以 exit 1 失败。可单独跑 `npm run check:build`（默认查 `dist/`）。

云端发布是把这个 `dist/` 放到服务器 nginx 静态根 `/opt/yonder-card/web/current`（`location /` 为 `try_files $uri $uri/ /index.html`），并把 `build-version.json`（`version`/`commit`/`builtAt`）一起发布；发布记录写 `web/RELEASE`。部署步骤与备份见 `~/Documents/yonder-lead/lanes/cloud-*.md`。

## 本机开发

```sh
npm run dev            # mock 数据，http://127.0.0.1:5180
VITE_API=http npm run dev   # 真实接口；/api 与 /ws 代理到 YONDER_SOCIAL（默认云端）
```

`scripts/dev-demo.sh` 的本机预览默认 mock；`YONDER_DEV_AUTOLOGIN=1` 相关逻辑只在 `vite serve` 生效，不进生产产物。
