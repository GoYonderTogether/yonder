# 无头浏览器截图方案调研（card-studio）

调研日期：2026-10-22。只读调研，未改动代码。数据来源为 GitHub 页面与 GitHub API（stars、license、最新 release 为抓取时点数值）。标注“未核实”的条目未能从官方来源确认。

## 对比表

| 方案 | 链接 | Stars | License | 最新 release | 平台 | 能否出像素截图 | CDP / Puppeteer / Playwright | 体积 / 启动时间 |
|---|---|---|---|---|---|---|---|---|
| Lightpanda | github.com/lightpanda-io/browser | 36.9k | AGPL-3.0 | 1.0.1（2026-10-15） | Linux、macOS、Docker；无原生 Windows | 否。README 称 “No graphical rendering engine”，`--dump png` 为 “text-only rendering”；第三方称 `Page.captureScreenshot` 返回占位图（未核实官方） | 提供 CDP，README 有 Puppeteer 示例 | README 称比 Chromium 轻 16x、快 9x（官方 benchmark）；体积未核实 |
| chrome-headless-shell（Chrome for Testing） | developer.chrome.com 文档；`npx @puppeteer/browsers install chrome-headless-shell@stable` | 不适用（Chromium 发行物） | Chromium 系（未核实细则） | 随 Chrome 版本发布（Chrome 120 起可经 CfT 下载） | Linux、macOS、Windows | 是（官方称适合 automated screenshotting） | 经 CDP 驱动，Puppeteer/Playwright 均支持 | 官方未给体积；启动时间未核实 |
| puppeteer-core | github.com/puppeteer/puppeteer | 95.7k | Apache-2.0 | 主包 release 日期未核实（@puppeteer/browsers 标签 2026-10-22） | 跨平台 | 作为驱动可截图 | 原生 CDP | 不含浏览器；`executablePath` 指定本机 Chrome；体积未核实 |
| playwright-core | github.com/microsoft/playwright | 98.3k | Apache-2.0 | v1.64.1（2026-10-14） | 跨平台 | 作为驱动可截图 | 自有协议 + CDP；默认下载 Chromium 与 headless shell | 支持 `channel: 'chrome'` 使用系统 Chrome（官方文档）；`executablePath` 文档页未核实 |
| Satori + resvg-js | github.com/vercel/satori（14.1k，MPL-2.0，0.63.2，2026-10-20）；github.com/thx/resvg-js（2.0k，MPL-2.0，v2.6.2，2024-03-26） | 见左 | MPL-2.0 | 见左 | Node.js 12–22；macOS、Linux（gnu/musl）、Windows，预编译二进制 | 是，但非浏览器渲染：Satori 输出 SVG，resvg 转 PNG | 无 CDP | 无浏览器；体积未核实 |
| resvg-js（纯 SVG） | github.com/thx/resvg-js | 2.0k | MPL-2.0 | v2.6.2（2024-03-26，较久未发版） | 同上 | 是（SVG→PNG，支持裁剪、缩放、背景色） | 无 | 无浏览器 |
| Obscura | github.com/h4ckf0r0day/obscura | 29.2k | Apache-2.0 | v0.2.5（2026-10-17） | Linux x86_64/ARM64、macOS、Windows | 是（README 称 viewport/full-page screenshot；与 Chromium 可能有差异） | 官方称实现 CDP，兼容 Puppeteer/Playwright | 有 `no-render` 构建变体；体积与启动时间未核实；项目较新 |
| wkhtmltoimage | wkhtmltopdf.org | 未核实 | LGPL-3.0 | 0.12.6（2020-06-10） | 跨平台 | 是（Qt WebKit 渲染） | 无 | 长期未发版；官网未明确标注 deprecated（未核实） |
| Servo | github.com/servo/servo | 38.2k | MPL-2.0 | 未核实 | 未核实 | 未核实（定位为可嵌入引擎，无已核实的截图 API） | 未核实 | 未核实 |
| Ladybird | github.com/LadybirdBrowser/ladybird | 66.6k | BSD-2-Clause | 未核实 | 未核实 | 未核实（未核实是否有可用 headless 截图） | 未核实 | 未核实 |
| Ferrum | github.com/rubycdp/ferrum | 2.1k | MIT | 未核实 | Ruby 库 | 可截图（经 Chrome） | CDP | 非 Node 方案，排除 |

## 结论要点

- Lightpanda 当前不适合做像素截图（无图形渲染引擎），且为 AGPL-3.0，捆绑需谨慎。
- Satori + resvg 适合纯 HTML/JSX 子集卡片的快速出图，但 CSS 支持有限（Satori 不保证与浏览器一致，不支持 `table`、`@font-face` 等），且不能执行真实 HTML/SVG 页面。
- 真实 CSS/SVG 像素还原仍以 Chromium 系为准。

## 推荐分层策略

1. **检测系统浏览器**：优先读取配置路径，其次探测 macOS（`/Applications/Google Chrome.app`、Microsoft Edge、Chromium）与 Linux（`google-chrome`、`chromium`、`microsoft-edge` 等）。用 puppeteer-core 的 `executablePath` 启动，不下载浏览器。
2. **回退**：无浏览器时，Satori + resvg-js 处理受限 HTML/JSX，纯 SVG 直接用 resvg-js。需在输出中提示降级。
3. **捆绑/推荐**：不默认捆绑浏览器（体积大，具体数值未核实）。可选提供 `@puppeteer/browsers` 安装 chrome-headless-shell 作为显式 opt-in。Lightpanda 暂不推荐用于截图；Obscura 可作为待评估项，但版本较新。
4. **生命周期**：首次截图时懒启动；单进程复用，每次截图新建 page 并用后关闭；每次使用重置 60s 计时器，空闲到期调用 `browser.close()` 并确保子进程被回收（进程退出时兜底 kill）。

## 待维护者确认 / 未核实

- Lightpanda 截图能力的“占位图”结论仅来自第三方文章，需对照官方文档或实测。
- 各方案的体积与启动耗时均未核实，需实测。
- Servo、Ladybird、wkhtmltoimage 的 headless 截图能力与 deprecated 状态未核实。
