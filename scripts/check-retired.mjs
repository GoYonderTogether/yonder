// 删除类卡片（S-R03…S-R08）的门禁：先证明替代功能已经上线，没通过就不许删。
// 只读检查：在临时 home 里启动真实 gateway，断言 views / stream / 路由 / 源码证据，不删任何东西。
// 读的是 dist 产物，先运行 npm run build。
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import WebSocket from "ws";

const ROOT = resolve(import.meta.dirname, "..");
/** 只用于 init 写 defaultModel；本检查不发起任何模型请求。 */
const MODEL = "openai/gpt-6-luna";
export const TARGETS = ["interaction-http", "tasks-http", "companion-swift", "interaction-web"];

export function parseArgs(argv) {
	const index = argv.indexOf("--target");
	const target = index < 0 ? undefined : argv[index + 1];
	if (!target || !TARGETS.includes(target))
		return { error: `用法：node scripts/check-retired.mjs --target ${TARGETS.join("|")}` };
	return { target };
}

/** interaction 的提问卡：floating 放置的 interaction 视图必须已由替代实现注册。 */
export function missingInteractionViews(views) {
	return views.some((view) => view.plugin === "interaction" && view.placement === "floating")
		? []
		: ["views.list 缺少 interaction 的 floating 提问卡视图"];
}

/** tasks 的看板/digest 必须以 view 形式出现。 */
export function missingTasksViews(views) {
	const hit = (view) =>
		view.plugin === "tasks" && /board|digest|看板/i.test(`${view.id ?? ""} ${view.title ?? ""} ${view.data ?? ""}`);
	return views.some(hit) ? [] : ["views.list 缺少 tasks 的看板/digest 视图"];
}

/**
 * 状态栏不再承载窗口（S-R06 后续）：源码里不得再出现 WKWebView 或 `/console/` 页面入口，
 * 否则说明悬浮窗被重新引入，而交互卡已由控制面视图承接。
 */
export function missingSwiftCompanion(sources) {
	const text = sources.join("\n");
	const missing = [];
	if (/WKWebView/.test(text)) missing.push("packages/macos 仍然加载 WKWebView 页面");
	if (/shell=desktop/.test(text)) missing.push("packages/macos 仍然引用 /console/?shell=desktop");
	return missing;
}

/** apps/app 构建产物是旧悬浮窗页面与云端前端的替代。 */
export function missingWebBuild(hasIndexHtml) {
	return hasIndexHtml ? [] : ["apps/app 缺少构建产物 apps/app/dist/index.html"];
}

/** 订阅一个 stream 方法，等到 ready 帧（首个 result）或 end 帧。 */
export function streamReady(base, cookie, method, params = {}, timeoutMs = 10_000) {
	return new Promise((done, fail) => {
		const socket = new WebSocket(`${base.replace(/^http/, "ws")}/api/stream?v=1`, { headers: { cookie } });
		const timer = setTimeout(() => {
			socket.close();
			fail(new Error(`${method} 在 ${timeoutMs}ms 内没有 ready 帧`));
		}, timeoutMs);
		const settle = (error, result) => {
			clearTimeout(timer);
			socket.close();
			if (error) fail(error);
			else done(result);
		};
		socket.on("open", () => socket.send(JSON.stringify({ t: "sub", sub: "gate", method, params })));
		socket.on("message", (raw) => {
			let frame;
			try {
				frame = JSON.parse(String(raw));
			} catch {
				return settle(new Error(`${method} 收到非 JSON 帧`));
			}
			if (frame.sub !== "gate") return;
			if (frame.t === "ready") return settle(undefined, frame.result);
			if (frame.t === "end") return settle(new Error(`${method} 结束：${frame.error?.code ?? frame.reason}`));
		});
		socket.on("error", (error) => settle(error));
	});
}

async function rpc(base, cookie, method, params = {}) {
	const response = await fetch(`${base}/api/rpc/${method}`, {
		method: "POST",
		headers: { "content-type": "application/json", cookie },
		body: JSON.stringify(params),
	});
	return await response.json();
}

async function login(base, home) {
	let token;
	try {
		token = JSON.parse(await readFile(join(home, ".yonder", "gateway.json"), "utf8")).token;
	} catch (error) {
		throw new Error(`读不到 gateway.json：${error.message}`);
	}
	const first = await fetch(`${base}/?token=${encodeURIComponent(token)}`, { redirect: "manual" });
	const cookie = (first.headers.get("set-cookie") ?? "").split(";")[0];
	if (!cookie) throw new Error(`启动票据登录失败：HTTP ${first.status}`);
	return cookie;
}

/** 临时 home、真实 kernel、真实 gateway；回调结束后全部清理。 */
async function withGateway(check) {
	let core;
	let gatewayModule;
	try {
		core = await import("../packages/core/dist/index.js");
		gatewayModule = await import("../packages/gateway/dist/index.js");
	} catch (error) {
		throw new Error(`缺少构建产物（先运行 npm run build）：${error.message}`);
	}
	// 前缀要短：channel-cli 的 unix socket 落在 home 下，sun_path 上限 104 字节。
	const home = await mkdtemp(join(tmpdir(), "yr-"));
	let kernel;
	let gateway;
	try {
		try {
			await core.initHome(home, "owner", { model: MODEL });
			kernel = await core.openKernel(home);
		} catch (error) {
			throw new Error(`启动临时 home 失败（先运行 npm run build）：${error.message}`);
		}
		gateway = await gatewayModule.startGateway({
			home,
			host: {
				kernel,
				home,
				releaseInfo: () => core.releaseInfo(home),
				awakeStatus: () => ({}),
				stop: () => {},
			},
		});
		const base = `http://127.0.0.1:${gateway.port}`;
		return await check({ base, home, cookie: await login(base, home) });
	} finally {
		await gateway?.close().catch(() => {});
		await kernel?.close().catch(() => {});
		await rm(home, { recursive: true, force: true });
	}
}

async function listedViews(env) {
	const reply = await rpc(env.base, env.cookie, "views.list");
	if (reply?.ok !== true) return { views: [], error: `views.list 不可用：${reply?.error?.message ?? "no reply"}` };
	return { views: reply.result?.views ?? [] };
}

async function interactionHttp() {
	return await withGateway(async (env) => {
		const { views, error } = await listedViews(env);
		const missing = error ? [error] : missingInteractionViews(views);
		try {
			await streamReady(env.base, env.cookie, "activity.watch");
		} catch (failure) {
			missing.push(`activity.watch 无响应：${failure.message}`);
		}
		return missing;
	});
}

async function tasksHttp() {
	return await withGateway(async (env) => {
		const { views, error } = await listedViews(env);
		return error ? [error] : missingTasksViews(views);
	});
}

async function swiftSources() {
	const sources = [];
	const walk = async (directory) => {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			if (entry.name === "dist" || entry.name === ".build" || entry.name === "node_modules") continue;
			const path = join(directory, entry.name);
			if (entry.isDirectory()) await walk(path);
			else if (entry.name.endsWith(".swift")) sources.push(await readFile(path, "utf8"));
		}
	};
	await walk(join(ROOT, "packages/macos"));
	return sources;
}

async function companionSwift() {
	if (process.platform !== "darwin") return { missing: [], skipped: "companion-swift 只在 macOS 上检查" };
	const missing = missingSwiftCompanion(await swiftSources());
	return { missing };
}

async function interactionWeb() {
	const hasIndex = await readFile(join(ROOT, "apps/app/dist/index.html"), "utf8").then(
		() => true,
		() => false,
	);
	return { missing: [...missingWebBuild(hasIndex), ...(await interactionHttp())] };
}

export async function runTarget(target) {
	if (target === "interaction-http") return { missing: await interactionHttp() };
	if (target === "tasks-http") return { missing: await tasksHttp() };
	if (target === "companion-swift") return await companionSwift();
	if (target === "interaction-web") return await interactionWeb();
	return { missing: [`未知目标：${target}`] };
}

async function main(argv) {
	const { target, error } = parseArgs(argv);
	if (error) {
		console.error(error);
		return 2;
	}
	let outcome;
	try {
		outcome = await runTarget(target);
	} catch (failure) {
		console.error(`${target} 检查无法执行：${failure.message}`);
		return 1;
	}
	if (outcome.skipped) {
		console.log(`跳过：${outcome.skipped}`);
		return 0;
	}
	if (outcome.missing.length) {
		console.error(`${target} 门禁未通过，不许删除：`);
		for (const item of outcome.missing) console.error(`- ${item}`);
		return 1;
	}
	console.log(`${target} 门禁通过：替代功能已上线`);
	return 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
	process.exitCode = await main(process.argv.slice(2));
