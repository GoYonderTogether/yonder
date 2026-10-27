# card-studio：让 Agent 做名片、预览名片（草案）

状态：草案（2026-10-22），未进 `docs/spec/`，需维护者批准后再写规范和决定记录。依据：`yonder-card-web/docs/card-form.md`（v3 卡片形态）、`card-page-v4.md`（名片页分区）、本目录 `headless-browser-research.md`。

## 1. 要解决的事

Agent 能按统一的卡片结构生成名片（字段或定制卡面），并在推给主人前，自己截图看看手机、桌面、分享图三种形态对不对；还能管理主人的分身卡和自己的 Agent 卡（只存草稿，发布永远由人在网页上点）。

## 2. 拆分

| 部分 | 放哪 | 理由 |
|---|---|---|
| 卡片结构、组件、主题、安全区、渲染 | 新插件 `plugins/card-studio` | 纯本地，不需要账号；网页端复用同一份组件源码 |
| 列表、读取、存草稿 | 现有 `plugins/channel-card` 增加工具 | 设备令牌在那里，插件之间不能互调 |

## 3. 工具

card-studio：
- `card_compose(face | svg | html, theme)` → 校验并返回规范化卡面（`CardFace` 或定制卡面）。
- `card_render(card, sizes?, browser?)` → 本地截图，默认 `mobile 390×844`、`desktop 1280×800`、`share`，返回图片附件路径。
- `card_check(card)` → 安全区、文字溢出、对比度、二维码可扫，返回问题列表。

channel-card 增加：
- `card_list(scope: mine | agent | collected)`、`card_get(id)`、`card_save_draft(id?, respondent, face, markdown, display?)`。

## 4. 截图用的浏览器

分层，按顺序选第一个可用的；工具参数 `browser` 可指定，未配置时由工具描述引导 Agent 选择：
1. 配置项或参数里指定的可执行文件；
2. 本机 Chrome / Edge / Chromium（macOS、Linux 常见路径），用 `puppeteer-core` 驱动；
3. 可选安装 `chrome-headless-shell`（`@puppeteer/browsers`，不默认捆绑）；
4. 都没有：纯字段卡面用 Satori + resvg-js 出图并标明「降级渲染」；定制 HTML 卡面直接报错说明缺浏览器。

生命周期：第一次截图时启动，单进程复用，每次截图新开页面用完关掉；空闲 60 秒关闭浏览器；插件 `stop` 时兜底回收。

不采用：Lightpanda（README 写明没有图形渲染引擎，且 AGPL）；Obscura（README 称支持截图和 CDP，但项目很新、未实测）暂不采用。

## 5. 待定

1. 组件源码放哪：网页仓库还是本仓库 `packages/`，以便两边共用。
2. 截图产物目录与清理策略。
3. 新依赖 `puppeteer-core`、`satori`、`@resvg/resvg-js` 需要维护者同意。
