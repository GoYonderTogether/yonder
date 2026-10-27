// Regenerate every file in brand/assets from brand/src/yonder-mark.js.
// SVGs always; PNG/ICO need Google Chrome (headless) and are skipped with a note when it is missing.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { markSVG, PALETTE } from "../src/yonder-mark.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "assets");
rmSync(out, { recursive: true, force: true });
for (const d of ["svg", "png", "web", "macos"]) mkdirSync(join(out, d), { recursive: true });

const { ink, paper, night, moon } = PALETTE;
const svgs = {
	"svg/yonder-mark.svg": markSVG({ color: ink }),
	"svg/yonder-mark-white.svg": markSVG({ color: paper }),
	"svg/yonder-mark-moon.svg": markSVG({ color: moon }),
	"svg/yonder-mark-small.svg": markSVG({ color: ink, smallCut: true }),
	"svg/yonder-mark-small-white.svg": markSVG({ color: paper, smallCut: true }),
	"svg/yonder-tile-ink.svg": markSVG({ color: paper, background: ink }),
	"svg/yonder-tile-night.svg": markSVG({ color: moon, background: night }),
	"svg/yonder-tile-small-ink.svg": markSVG({ color: paper, background: ink, smallCut: true, fit: 0.84 }),
	"web/favicon.svg": markSVG({ color: ink, smallCut: true, scheme: "auto" }),
	"macos/menubar-template.svg": markSVG({ color: "#000", smallCut: true }),
};
for (const [name, svg] of Object.entries(svgs)) writeFileSync(join(out, name), svg);

const chrome = [
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/usr/bin/google-chrome",
	"/usr/bin/chromium",
].find(existsSync);
const pngs = [
	// [file, source svg, size]
	["png/yonder-mark-512.png", "svg/yonder-mark.svg", 512],
	["png/yonder-mark-white-512.png", "svg/yonder-mark-white.svg", 512],
	["png/yonder-tile-ink-1024.png", "svg/yonder-tile-ink.svg", 1024],
	["png/yonder-tile-night-1024.png", "svg/yonder-tile-night.svg", 1024],
	["web/icon-192.png", "svg/yonder-tile-ink.svg", 192],
	["web/icon-512.png", "svg/yonder-tile-ink.svg", 512],
	["web/apple-touch-icon.png", "svg/yonder-tile-ink.svg", 180],
	["web/favicon-16.png", "svg/yonder-mark-small.svg", 16],
	["web/favicon-32.png", "svg/yonder-mark-small.svg", 32],
	["web/favicon-48.png", "svg/yonder-mark-small.svg", 48],
	// macOS menu bar: a template image (black + alpha), 18 pt at 1x and 2x
	["macos/menubar-template.png", "macos/menubar-template.svg", 18],
	["macos/menubar-template@2x.png", "macos/menubar-template.svg", 36],
];
const written = [];
if (chrome) {
	const tmp = mkdtempSync(join(tmpdir(), "yonder-brand-"));
	for (const [file, src, px] of pngs) {
		const page = join(tmp, "page.html");
		// Chrome renders at no less than 1024 px; small sizes are then downsampled, which also antialiases them well.
		const big = Math.max(px, 1024);
		const svg = readFileSync(join(out, src), "utf8").replace(
			/width="256" height="256"/,
			`width="${big}" height="${big}"`,
		);
		writeFileSync(
			page,
			`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`,
		);
		const r = spawnSync(
			chrome,
			[
				"--headless=new",
				"--disable-gpu",
				"--hide-scrollbars",
				"--default-background-color=00000000",
				`--window-size=${big},${big}`,
				`--screenshot=${join(out, file)}`,
				`file://${page}`,
			],
			{ stdio: "ignore", timeout: 60_000 },
		);
		if (r.status !== 0 || !existsSync(join(out, file))) throw new Error(`Chrome could not render ${file}`);
		if (big !== px) {
			const z = spawnSync("/usr/bin/sips", ["-z", String(px), String(px), join(out, file)], { stdio: "ignore" });
			if (z.status !== 0) throw new Error(`sips could not resize ${file}`);
		}
		written.push(file);
	}
	rmSync(tmp, { recursive: true, force: true });
	// favicon.ico: three PNG frames in one ICO container
	const frames = [16, 32, 48].map((px) => ({ px, data: readFileSync(join(out, `web/favicon-${px}.png`)) }));
	const header = Buffer.alloc(6 + 16 * frames.length);
	header.writeUInt16LE(0, 0);
	header.writeUInt16LE(1, 2);
	header.writeUInt16LE(frames.length, 4);
	let offset = header.length;
	frames.forEach(({ px, data }, i) => {
		const e = 6 + 16 * i;
		header.writeUInt8(px, e);
		header.writeUInt8(px, e + 1);
		header.writeUInt16LE(1, e + 4);
		header.writeUInt16LE(32, e + 6);
		header.writeUInt32LE(data.length, e + 8);
		header.writeUInt32LE(offset, e + 12);
		offset += data.length;
	});
	writeFileSync(join(out, "web/favicon.ico"), Buffer.concat([header, ...frames.map((f) => f.data)]));
	written.push("web/favicon.ico");
} else console.warn("Google Chrome not found: PNG and ICO files were not generated.");

writeFileSync(
	join(out, "web/site.webmanifest"),
	`${JSON.stringify(
		{
			name: "Yonder",
			icons: [
				{ src: "icon-192.png", sizes: "192x192", type: "image/png" },
				{ src: "icon-512.png", sizes: "512x512", type: "image/png" },
			],
			theme_color: ink,
			background_color: ink,
		},
		null,
		"\t",
	)}\n`,
);

// A self-contained preview (opens from disk): the live character in every state, plus every static asset.
const lib = readFileSync(join(root, "src/yonder-mark.js"), "utf8").replace(/^export /gm, "");
const cells = Object.keys(svgs)
	.map(
		(f) =>
			`<figure><div class="${f.includes("white") || f.includes("moon") ? "dark" : ""}">${svgs[f]}</div><figcaption>${f}</figcaption></figure>`,
	)
	.join("");
writeFileSync(
	join(out, "preview.html"),
	`<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Yonder 标志资产</title>
<style>body{margin:0;padding:32px 16px;background:#f4f3ef;color:#111;font:14px/1.6 -apple-system,"PingFang SC",sans-serif}main{max-width:960px;margin:auto}
h1{font-size:22px;margin:0 0 4px}p{color:#777;margin:0 0 20px}.stage{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}
.live{background:#fff;border-radius:20px;padding:12px}.live.dark{background:${night}}.live svg{width:100%;display:block}
.bar{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0 32px}.bar button{all:unset;cursor:pointer;padding:8px 14px;border-radius:10px;border:1px solid #ddd;background:#fff}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}figure{margin:0;background:#fff;border-radius:14px;padding:14px}
figure div{display:grid;place-items:center;height:120px}figure div.dark{background:#111;border-radius:10px}figure svg{width:auto;height:100%}figcaption{color:#777;font-size:11px;margin-top:8px;word-break:break-all}
@media (max-width:640px){.stage{grid-template-columns:1fr}}</style>
<main><h1>Yonder 标志资产</h1><p>全部由 brand/src/yonder-mark.js 生成。眼睛和间隙是真实镂空，底下放什么都会透出来。</p>
<div class="stage"><div class="live"><svg id="a" role="img" aria-label="Yonder 动效（浅色底）"></svg></div><div class="live dark"><svg id="b" role="img" aria-label="Yonder 动效（夜空底）"></svg></div></div>
<div class="bar">${["tour", "idle", "listen", "work", "done", "sleep", "split"].map((s) => `<button type="button" data-s="${s}">${s}</button>`).join("")}</div>
<div class="grid">${cells}</div></main>
<script>${lib}
let a = createCharacter(document.getElementById("a"), { state: "tour" });
let b = createCharacter(document.getElementById("b"), { state: "tour", color: PALETTE.moon });
document.querySelector(".bar").addEventListener("click", (e) => { const s = e.target.dataset && e.target.dataset.s; if (!s) return;
a.destroy(); b.destroy(); a = createCharacter(document.getElementById("a"), { state: s }); b = createCharacter(document.getElementById("b"), { state: s, color: PALETTE.moon }); });
</script></html>\n`,
);

console.log(
	[...Object.keys(svgs), ...written, "web/site.webmanifest", "preview.html"].map((f) => `assets/${f}`).join("\n"),
);
