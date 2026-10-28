#!/usr/bin/env node
// 页面验收截图：本机 Chrome/Edge 无头 + CDP，零依赖（Node ≥22 自带 fetch/WebSocket）。
// 用法见同目录 README.md。
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";

const APP_DIR = resolve(import.meta.dirname, "..");
const PRESETS = { phone: [390, 844], tablet: [820, 1180], desktop: [1280, 800] };
const DEFAULT_BASE = "http://127.0.0.1:4173/";

const { values: opt } = parseArgs({
	options: {
		url: { type: "string", default: "#/" },
		out: { type: "string" },
		w: { type: "string" },
		h: { type: "string" },
		preset: { type: "string" },
		all: { type: "boolean", default: false },
		serve: { type: "boolean", default: false },
		port: { type: "string", default: "4173" },
		wait: { type: "string", default: "800" },
		help: { type: "boolean", default: false },
	},
});

function fail(msg) {
	console.error(`shoot: ${msg}`);
	process.exit(1);
}

if (opt.help) {
	console.log(
		"node apps/app/scripts/shoot.mjs --url <url|#/路由> --out <文件.png|目录> [--w 390 --h 844 | --preset phone|tablet|desktop | --all] [--serve] [--port 4173] [--wait 800]",
	);
	process.exit(0);
}
if (!opt.out) fail("缺少 --out");
if (opt.preset && !PRESETS[opt.preset]) fail(`未知预设 ${opt.preset}，可选 ${Object.keys(PRESETS).join("/")}`);

// 待拍列表：--all 三张预设；否则 --preset 或 --w/--h（默认 phone）
function shots() {
	if (opt.all) return Object.entries(PRESETS).map(([name, [w, h]]) => ({ w, h, file: join(opt.out, `${name}.png`) }));
	const [pw, ph] = PRESETS[opt.preset ?? "phone"];
	const w = Number(opt.w ?? pw);
	const h = Number(opt.h ?? ph);
	if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) fail("--w/--h 必须是正整数");
	return [{ w, h, file: opt.out }];
}

function findChrome() {
	const env = process.env.CHROME_PATH;
	if (env) {
		if (!existsSync(env)) fail(`CHROME_PATH 指向的文件不存在：${env}`);
		return env;
	}
	const candidates = {
		darwin: [
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			"/Applications/Chromium.app/Contents/MacOS/Chromium",
			"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
		],
		linux: [
			"/usr/bin/google-chrome",
			"/usr/bin/google-chrome-stable",
			"/usr/bin/chromium",
			"/usr/bin/chromium-browser",
			"/usr/bin/microsoft-edge",
		],
		win32: [
			`${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
			`${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
			`${process.env["PROGRAMFILES(X86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`,
		],
	}[process.platform];
	const found = (candidates ?? []).find((p) => existsSync(p));
	if (!found) fail("找不到 Chrome/Chromium/Edge。请安装其中之一，或用环境变量 CHROME_PATH 指定可执行文件路径。");
	return found;
}

function freePort() {
	return new Promise((ok, ko) => {
		const srv = createServer();
		srv.once("error", ko);
		srv.listen(0, "127.0.0.1", () => {
			const { port } = srv.address();
			srv.close(() => ok(port));
		});
	});
}

// 有界轮询，直到 fn 返回真值
async function until(what, ms, fn) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		try {
			const v = await fn();
			if (v) return v;
		} catch {}
		await sleep(200);
	}
	throw new Error(`等待${what}超时（${ms}ms）`);
}

function startPreview(port) {
	if (!existsSync(join(APP_DIR, "dist/index.html"))) fail("未找到 apps/app/dist，请先 npm run build -w @yonder/app");
	const vitePkg = createRequire(join(APP_DIR, "package.json")).resolve("vite/package.json");
	const vite = join(dirname(vitePkg), "bin/vite.js");
	return spawn(process.execPath, [vite, "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
		cwd: APP_DIR,
		stdio: ["ignore", "ignore", "inherit"],
	});
}

// 最小 CDP 客户端：send 返回 result，协议错误 reject；once 等一次事件
function connect(wsUrl) {
	const ws = new WebSocket(wsUrl);
	let seq = 0;
	const pending = new Map();
	const waiters = new Map();
	ws.onmessage = (e) => {
		let m;
		try {
			m = JSON.parse(e.data);
		} catch {
			return;
		}
		if (m.id && pending.has(m.id)) {
			const { resolve: ok, reject: ko } = pending.get(m.id);
			pending.delete(m.id);
			m.error ? ko(new Error(`${m.error.message}`)) : ok(m.result);
		} else if (m.method && waiters.has(m.method)) {
			for (const fn of waiters.get(m.method)) fn(m.params);
			waiters.delete(m.method);
		}
	};
	const cdp = {
		ws,
		ready: new Promise((ok, ko) => {
			ws.onopen = ok;
			ws.onerror = () => ko(new Error("CDP 连接失败"));
		}),
		send: (method, params = {}) =>
			new Promise((ok, ko) => {
				const id = ++seq;
				pending.set(id, { resolve: ok, reject: ko });
				ws.send(JSON.stringify({ id, method, params }));
			}),
		once: (method, ms) =>
			new Promise((ok, ko) => {
				const t = setTimeout(() => ko(new Error(`等待 ${method} 超时（${ms}ms）`)), ms);
				const list = waiters.get(method) ?? [];
				list.push((p) => {
					clearTimeout(t);
					ok(p);
				});
				waiters.set(method, list);
			}),
	};
	return cdp;
}

// 只清理本次启动的子进程：已发 SIGTERM，3 秒未退出再 SIGKILL
async function stop(p) {
	const alive = () => p.exitCode === null && p.signalCode === null;
	if (alive()) await Promise.race([new Promise((r) => p.once("exit", r)), sleep(3000)]);
	if (alive()) p.kill("SIGKILL");
}

async function main() {
	const list = shots();
	const chromePath = findChrome();
	const wait = Number(opt.wait);
	const base = opt.serve ? `http://127.0.0.1:${opt.port}/` : DEFAULT_BASE;
	// '#/x' 或 '/x' 视为相对 base；完整 URL 原样使用
	const url = /^[a-z]+:/i.test(opt.url) ? opt.url : new URL(opt.url, base).href;

	const procs = [];
	const profile = await mkdtemp(join(tmpdir(), "yonder-shoot-"));
	let cdp;
	try {
		if (opt.serve) {
			procs.push(startPreview(opt.port));
			await until("vite preview 启动", 15000, async () => (await fetch(base)).ok);
		}
		const port = await freePort();
		procs.push(
			spawn(
				chromePath,
				[
					"--headless=new",
					`--remote-debugging-port=${port}`,
					`--user-data-dir=${profile}`,
					"--no-first-run",
					"--no-default-browser-check",
					"--disable-gpu",
					"--hide-scrollbars",
					"about:blank",
				],
				{ stdio: "ignore" },
			),
		);
		const target = await until("Chrome DevTools 端口", 15000, async () => {
			const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
			return targets.find((t) => t.type === "page");
		});
		cdp = connect(target.webSocketDebuggerUrl);
		await cdp.ready;
		await cdp.send("Page.enable");

		for (const { w, h, file } of list) {
			await cdp.send("Emulation.setDeviceMetricsOverride", {
				width: w,
				height: h,
				deviceScaleFactor: 1,
				mobile: w < 1024,
			});
			// 先回到空白页，保证同一 URL（仅 hash 不同）也会重新加载
			const blank = cdp.once("Page.loadEventFired", 15000);
			await cdp.send("Page.navigate", { url: "about:blank" });
			await blank;
			const loaded = cdp.once("Page.loadEventFired", 30000);
			const nav = await cdp.send("Page.navigate", { url });
			if (nav.errorText) throw new Error(`打开 ${url} 失败：${nav.errorText}`);
			await loaded;
			await sleep(wait);
			const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
			await mkdir(dirname(resolve(file)), { recursive: true });
			await writeFile(file, Buffer.from(shot.data, "base64"));
			console.log(`${file}  ${w}×${h}  ${url}`);
		}
	} finally {
		cdp?.ws.close();
		for (const p of procs) p.kill("SIGTERM");
		await Promise.all(procs.map(stop));
		await rm(profile, { recursive: true, force: true }).catch(() => {});
	}
}

main().catch((e) => {
	console.error(`shoot: ${e.message}`);
	process.exitCode = 1;
});
