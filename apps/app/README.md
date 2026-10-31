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

## 原网址实时预览

`npm run dev:live` 只构建当前 `apps/app` 并用 SSH 把回环 5173 转到服务器 18052；不上传源码、不修改后端或数据库。始终使用真实 API，构建成功且通过现有 API 产物检查后才发布新页面。保存后等待构建完成，再刷新原网址查看；沿用现有 PWA，不自动刷新正在输入的页面。

本机 launchd `dev.yonder.app-live` 运行此命令；日志在 `~/.local/state/yonder-web-live/worker.log`。构建目录为仓库 `.build/web-live/`，保留旧 hash 供已打开页面读取。Mac 须保持在线；隧道断线由 launchd 重启。

```sh
launchctl print gui/$(id -u)/dev.yonder.app-live      # 本机状态
tail -f ~/.local/state/yonder-web-live/worker.log    # 构建与隧道日志
curl -fsS https://yonderbot.net/build-version.json # mode=live
node apps/app/scripts/live-preview.mjs --check      # 仓库根运行，已有构建的 HTTP 边界检查
```

线上 nginx 的 `location /` 和 `/yonder-sw.js` 指向 `http://127.0.0.1:18052`，`/api`、业务 WebSocket 和 `/console` 保留原服务器入口。停止预览前，先将根路径恢复为 `try_files $uri $uri/ /index.html`、worker 恢复为 `/opt/yonder-card/web/current/yonder-sw.js` 的 alias，执行 `nginx -t` 和 reload，再 `launchctl bootout gui/$(id -u)/dev.yonder.app-live`；服务器现有 `web/current` 是静态回退版本。本次静态配置备份在 `/opt/yonder-card/backups/web-live-fix-20261030T074014Z/yonder-static.conf`，恢复前核对后续部署是否改过配置，不覆盖其他站点变更。不要运行旧 `yonder-card-web/deploy/dev.mjs prod`，它会同时回退云端后端。

上述 launchd plist 保存在 `~/Library/LaunchAgents/dev.yonder.app-live.plist`，停止后可用 `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.yonder.app-live.plist` 启动；启动前先确认 nginx 已按上述只前端的代理配置就绪。单独运行 `npm run dev:live` 不会改 nginx；launchd 已运行时不要再开第二个实例。
