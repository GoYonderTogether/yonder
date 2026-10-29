#!/usr/bin/env node
// 视觉对照（FP01 D7）：同一份内置原型数据下，对「名片站原版」与「移植版」逐页截图并算像素差异。
// 两边都以 VITE_API 未设置（原型数据）的 vite dev 运行；登录一次后用前端路由跳转，避免整页刷新重置内存数据。
// 用法：node apps/app/scripts/compare-shots.mjs --a http://127.0.0.1:5191 --b http://127.0.0.1:5181 --out <目录> [--threshold 0.01]
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";

const { values: opt } = parseArgs({
	options: {
		a: { type: "string" },
		b: { type: "string" },
		out: { type: "string" },
		threshold: { type: "string", default: "0.01" },
		wait: { type: "string", default: "1200" },
		// 只截部分页面/宽度：--pages messages=/,work=/work --widths 390,1440（登录页总是第一张）
		pages: { type: "string" },
		widths: { type: "string" },
	},
});
function fail(msg) {
	console.error(`compare-shots: ${msg}`);
	process.exit(1);
}
if (!opt.a || !opt.b || !opt.out) fail("需要 --a --b --out");

const ALL_WIDTHS = [
	[390, 844],
	[820, 1180],
	[1440, 900],
];
const ALL_PAGES = [
	["login", "/login"],
	["messages", "/"],
	["chat", "/c/c-1"],
	["contacts", "/contacts"],
	["contact-detail", "/contacts/u-2"],
	["cards", "/cards"],
	["add-friend", "/friends/add"],
	["me", "/me"],
	["public-card", "/u/k-7"],
];

const WIDTHS = opt.widths
	? opt.widths.split(",").map((w) => ALL_WIDTHS.find(([x]) => x === Number(w)) ?? fail(`未知宽度 ${w}`))
	: ALL_WIDTHS;
const PAGES = opt.pages ? [ALL_PAGES[0], ...opt.pages.split(",").map((item) => item.split("=", 2))] : ALL_PAGES;

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

async function stop(p) {
	const alive = () => p.exitCode === null && p.signalCode === null;
	if (alive()) await Promise.race([new Promise((r) => p.once("exit", r)), sleep(3000)]);
	if (alive()) p.kill("SIGKILL");
}

const png = (data) => Buffer.from(data, "base64");

// 在 Chrome 里用 canvas 比较两张 PNG：任一通道差 >12 记为不同像素
const DIFF_JS = (a, b) => `(async () => {
	const load = (d) => new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = "data:image/png;base64," + d; });
	const [x, y] = await Promise.all([load(${JSON.stringify(a)}), load(${JSON.stringify(b)})]);
	if (x.width !== y.width || x.height !== y.height) return { size: false };
	const px = (i) => { const c = document.createElement("canvas"); c.width = i.width; c.height = i.height; const g = c.getContext("2d"); g.drawImage(i, 0, 0); return g.getImageData(0, 0, i.width, i.height).data; };
	const p = px(x), q = px(y); let n = 0;
	for (let k = 0; k < p.length; k += 4) if (Math.abs(p[k] - q[k]) > 12 || Math.abs(p[k+1] - q[k+1]) > 12 || Math.abs(p[k+2] - q[k+2]) > 12) n++;
	return { size: true, diff: n / (p.length / 4) };
})()`;

async function openBrowser() {
	const port = await freePort();
	const profile = await mkdtemp(join(tmpdir(), "yonder-cmp-"));
	const proc = spawn(
		findChrome(),
		[
			"--headless=new",
			`--remote-debugging-port=${port}`,
			`--user-data-dir=${profile}`,
			"--no-first-run",
			"--disable-gpu",
			"--hide-scrollbars",
			"about:blank",
		],
		{ stdio: "ignore" },
	);
	const target = await until("Chrome DevTools 端口", 15000, async () =>
		(await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"),
	);
	const cdp = connect(target.webSocketDebuggerUrl);
	await cdp.ready;
	await cdp.send("Page.enable");
	await cdp.send("Runtime.enable");
	return {
		cdp,
		close: async () => {
			cdp.ws.close();
			proc.kill("SIGTERM");
			await stop(proc);
			await rm(profile, { recursive: true, force: true }).catch(() => {});
		},
	};
}

const evalJs = async (cdp, expression) => {
	const r = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
	if (r.exceptionDetails)
		throw new Error(`${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ""}`);
	return r.result.value;
};

async function navigate(cdp, url) {
	const loaded = cdp.once("Page.loadEventFired", 30000);
	const nav = await cdp.send("Page.navigate", { url });
	if (nav.errorText) throw new Error(`打开 ${url} 失败：${nav.errorText}`);
	await loaded;
}

async function type(cdp, selector, text) {
	await evalJs(cdp, `document.querySelector(${JSON.stringify(selector)}).focus()`);
	await cdp.send("Input.insertText", { text });
}

// 一个站点：先截 /login，再登录，其余页面用 pushState + popstate 跳转
async function shootSite(base, w, h, wait) {
	const { cdp, close } = await openBrowser();
	const out = new Map();
	try {
		await cdp.send("Emulation.setDeviceMetricsOverride", {
			width: w,
			height: h,
			deviceScaleFactor: 1,
			mobile: w < 1024,
		});
		await navigate(cdp, new URL("/login", base).href);
		await sleep(Number(wait));
		const snap = async (name) => out.set(name, (await cdp.send("Page.captureScreenshot", { format: "png" })).data);
		await snap("login");
		// 移植版登录页默认是验证码表单（FP02-1），原型数据仍用邮箱+密码登录。
		await evalJs(
			cdp,
			`[...document.querySelectorAll("button")].find((b) => b.textContent === "用邮箱和密码登录")?.click()`,
		);
		await sleep(300);
		await type(cdp, 'input[autocomplete="username"]', "demo@example.com");
		await type(cdp, 'input[type="password"]', "demo-password");
		await evalJs(cdp, `document.querySelector("form").requestSubmit()`);
		await sleep(1500);
		for (const [name, path] of PAGES.slice(1)) {
			await evalJs(
				cdp,
				`history.pushState({}, "", ${JSON.stringify(path)}); dispatchEvent(new PopStateEvent("popstate"))`,
			);
			await sleep(Number(wait));
			await snap(name);
		}
	} finally {
		await close();
	}
	return out;
}

async function main() {
	const rows = [];
	const { cdp, close } = await openBrowser();
	try {
		await mkdir(resolve(opt.out), { recursive: true });
		for (const [w, h] of WIDTHS) {
			const [A, B] = [await shootSite(opt.a, w, h, opt.wait), await shootSite(opt.b, w, h, opt.wait)];
			for (const [name] of PAGES) {
				const a = A.get(name),
					b = B.get(name);
				const stem = join(resolve(opt.out), `${name}-${w}`);
				await writeFile(`${stem}-a.png`, png(a));
				await writeFile(`${stem}-b.png`, png(b));
				const r = await evalJs(cdp, DIFF_JS(a, b));
				rows.push({ name, w, ...r });
				console.log(`${name} ${w}: ${r.size ? `${(r.diff * 100).toFixed(3)}%` : "尺寸不同"}`);
			}
		}
	} finally {
		await close();
	}
	const bad = rows.filter((r) => !r.size || r.diff > Number(opt.threshold));
	await writeFile(join(resolve(opt.out), "rows.json"), JSON.stringify(rows, null, 1));
	if (bad.length) process.exitCode = 2;
}
main().catch((e) => {
	console.error(`compare-shots: ${e.message}`);
	process.exitCode = 1;
});
