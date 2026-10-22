# Yonder 标志

Yonder 的标志"同望"：一大一小两颗软圆星体，小的刚从大的背后升起，两个一起望向右上方的远处。静态标志是角色"待机"的那一帧；角色醒着时会呼吸、眨眼、看你、绕行、分裂。

**这里是唯一的设计来源。** 状态栏、网页、文档、安装包等任何地方用到标志，都引用这里的文件，不要复制修改。设计要变，只改 `src/yonder-mark.js`，然后重新生成；各处跟着一起变。

## 目录

| 路径 | 内容 |
|---|---|
| `src/yonder-mark.js` | 几何参数（`MARK`）、配色（`PALETTE`）、静态绘制（`markPath` / `markSVG`）、动效（`createCharacter`）。无依赖，浏览器和 Node 都能直接 import |
| `scripts/build.mjs` | 从上面的模块生成 `assets/` 下的全部文件 |
| `assets/` | 生成物，不要手改 |
| `assets/preview.html` | 预览页：动效的各个状态，加上全部静态资产；可直接双击打开 |

重新生成：

```bash
npm run build:brand
```

SVG 总会生成；PNG 和 ICO 需要本机装有 Google Chrome（无头渲染），再用 macOS 自带的 `sips` 缩到目标尺寸。

## 资产清单

| 文件 | 用途 |
|---|---|
| `assets/svg/yonder-mark.svg` | 主标志，墨色，透明底 |
| `assets/svg/yonder-mark-white.svg` | 主标志，白色，用于深色底 |
| `assets/svg/yonder-mark-moon.svg` | 主标志，月白色，用于夜空底 |
| `assets/svg/yonder-mark-small.svg`、`-small-white.svg` | 24 px 及以下的简化版：小星不画眼睛，大星眼睛和间隙加大 |
| `assets/svg/yonder-tile-ink.svg`、`yonder-tile-night.svg`、`yonder-tile-small-ink.svg` | 圆角方块图标（墨色底 / 夜空底） |
| `assets/png/` | 512 px 透明底标志、1024 px 方块图标 |
| `assets/web/` | `favicon.svg`（随系统深浅色切换）、`favicon.ico`（16/32/48）、`apple-touch-icon.png`、`icon-192/512.png`、`site.webmanifest` |
| `assets/macos/menubar-template.png`、`@2x.png`、`.svg` | macOS 状态栏模板图（黑色 + 透明，18 pt），设为 `isTemplate = true` 后由系统着色 |

所有标志都是一条 `fill-rule="evenodd"` 的路径：眼睛和两颗星之间的间隙是**真实镂空**，放在任何底色、渐变或照片上都会透出底下的内容。只有一种颜色，可以直接改 `fill`。

## 在各处引用

网页（静态）：

```html
<link rel="icon" href="/brand/web/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/brand/web/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="/brand/web/apple-touch-icon.png">
<link rel="manifest" href="/brand/web/site.webmanifest">
<img src="/brand/svg/yonder-mark.svg" alt="Yonder" width="64" height="64">
```

网页（动效）：

```html
<svg id="yonder" width="200" height="200"></svg>
<script type="module">
	import { createCharacter } from "./brand/src/yonder-mark.js";
	const bot = createCharacter(document.getElementById("yonder"), { state: "idle" });
	// bot.setState("work")  // idle · listen · work · done · sleep · split，或创建时传 state: "tour" 自动轮播
</script>
```

`color` 参数改颜色；系统开启"减少动态效果"时角色静止在关键帧上。

macOS 状态栏：把 `assets/macos/menubar-template.png` 和 `@2x.png` 打进 app 资源，`NSImage(named:)` 读取后设 `isTemplate = true`。目前 `packages/macos/YonderStatus.swift` 仍用系统符号 `terminal`，尚未接入。

## 动效状态

| 状态 | 表现 |
|---|---|
| `idle` 待机 | 呼吸、随机眨眼（偶尔连眨两下）、两颗星一起望远，目光偶有微动 |
| `listen` 倾听 | 两颗星跟着指针转头 |
| `work` 工作 | 小星沿看不见的倾斜轨道绕大星运行：在前面经过时被间隙切出，绕到后面时被挡住；大星目送它 |
| `done` 完成 | 笑眼（^ ^），大星先跳、小星后跳，落地挤压回弹 |
| `sleep` 睡眠 | 闭眼、慢呼吸，小星躲到大星背后 |
| `split` 分裂 | 小星从大星里挤出来，转到关键帧的位置停下 |

全部运动由阻尼弹簧驱动（转头、跟随、跳跃、绕行），所以有自然的过冲和回落。

## 来源说明

动效的做法参考了 [grok-icon-study](https://github.com/blessonism/grok-icon-study)（弹簧、状态机、眨眼节奏）和 [agent-hud-open](https://github.com/jazzenchen/agent-hud-open)（标志即角色的静止帧、表情与姿态分离），但没有使用它们的代码、几何或素材：前者的素材归 xAI 所有，仅供学习，不得商用。本目录的代码与造型均为独立编写。商标检索尚未做。
