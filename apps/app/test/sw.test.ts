import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, test, vi } from "vitest";

const source = readFileSync(new URL("../public/yonder-sw.js", import.meta.url), "utf8");

interface StubRequest {
	url: string;
	method?: string;
	mode?: string;
	destination?: string;
}

interface StubEvent {
	request: StubRequest;
	respondWith(response: Promise<unknown>): void;
	waitUntil(promise: Promise<unknown>): void;
}

type Listener = (event: StubEvent) => void;

/** 在沙箱里加载 worker 源码，用桩 self 捕获注册的监听器；不依赖浏览器的 ServiceWorker 全局。 */
function loadWorker(scriptUrl = "https://console.test/console/yonder-sw.js") {
	const listeners = new Map<string, Listener>();
	const stored = new Map<string, unknown>();
	const puts: string[] = [];
	const deleted: string[] = [];
	const fetched: string[] = [];
	const cache = {
		match: async (request: StubRequest) => stored.get(new URL(request.url).pathname),
		put: async (request: StubRequest, response: unknown) => {
			puts.push(new URL(request.url).pathname);
			stored.set(new URL(request.url).pathname, response);
		},
	};
	const caches = {
		open: async () => cache,
		keys: async () => ["yonder-console-assets-v0", "yonder-console-assets-v1", "yonder-card-shell-v1"],
		delete: async (key: string) => void deleted.push(key),
	};
	const self = {
		location: { href: scriptUrl },
		addEventListener: (type: string, listener: Listener) => void listeners.set(type, listener),
		skipWaiting: async () => {},
		clients: { claim: async () => {} },
	};
	runInNewContext(source, {
		self,
		caches,
		URL,
		fetch: async (request: StubRequest) => {
			fetched.push(new URL(request.url).pathname);
			return { ok: true, clone: () => ({ url: request.url }) };
		},
	});
	return { listeners, puts, deleted, fetched };
}

function dispatch(worker: ReturnType<typeof loadWorker>, request: StubRequest) {
	const listener = worker.listeners.get("fetch");
	if (!listener) throw new Error("worker 没有注册 fetch 监听");
	const state: { responded: boolean; response?: Promise<unknown> } = { responded: false };
	// 真实 Request 总有 method，桩里省略时按 GET。
	listener({
		request: { ...request, method: request.method ?? "GET" },
		respondWith: (response) => {
			state.responded = true;
			state.response = response;
		},
		waitUntil: () => {},
	});
	return state;
}

test("控制台导航从不被拦截，带 basePath 时也一样", () => {
	const worker = loadWorker();
	for (const url of [
		"https://console.test/console/",
		"https://console.test/console",
		"https://console.test/console/some/deep/link",
		"https://console.test/console/login",
	]) {
		expect(dispatch(worker, { url, mode: "navigate" }).responded).toBe(false);
		// 某些浏览器以 destination 标记文档请求，即便 mode 不是 navigate 也不能接管。
		expect(dispatch(worker, { url, destination: "document" }).responded).toBe(false);
	}
	expect(worker.fetched).toEqual([]);
});

test("API 与 WebSocket 请求旁路，包括 scope 外的绝对路径", () => {
	const worker = loadWorker();
	for (const url of [
		"https://console.test/console/api/rpc/facts",
		"https://console.test/console/api/stream?v=1",
		"https://console.test/api/rpc/facts",
		"https://console.test/console/ws",
		"https://console.test/ws",
	]) {
		expect(dispatch(worker, { url }).responded).toBe(false);
	}
	expect(worker.fetched).toEqual([]);
});

test("只缓存 scope 内 assets/ 的同源 GET 请求", async () => {
	const worker = loadWorker();
	const asset = { url: "https://console.test/console/assets/index-abc123.js" };
	const first = dispatch(worker, asset);
	expect(first.responded).toBe(true);
	await first.response;
	expect(worker.fetched).toEqual(["/console/assets/index-abc123.js"]);
	expect(worker.puts).toEqual(["/console/assets/index-abc123.js"]);

	const second = dispatch(worker, asset);
	expect(second.responded).toBe(true);
	await second.response;
	// 命中缓存后不再走网络
	expect(worker.fetched).toEqual(["/console/assets/index-abc123.js"]);

	for (const request of [
		{ url: "https://console.test/console/manifest.webmanifest" },
		{ url: "https://console.test/console/version.json" },
		{ url: "https://console.test/console/index.html" },
		{ url: "https://console.test/console/brand/yonder-tile-ink.svg" },
		{ url: "https://other.test/console/assets/index-abc123.js" },
		{ url: "https://console.test/console/assets/index-abc123.js", method: "POST" },
	]) {
		expect(dispatch(worker, request).responded).toBe(false);
	}
});

test("本机 basePath=/ 时同样只接管 /assets/", async () => {
	const worker = loadWorker("https://console.test/yonder-sw.js");
	expect(dispatch(worker, { url: "https://console.test/", mode: "navigate" }).responded).toBe(false);
	expect(dispatch(worker, { url: "https://console.test/api/rpc/facts" }).responded).toBe(false);
	expect(dispatch(worker, { url: "https://console.test/ws" }).responded).toBe(false);
	expect(dispatch(worker, { url: "https://console.test/console/assets/a.js" }).responded).toBe(false);
	const asset = dispatch(worker, { url: "https://console.test/assets/index-abc123.js" });
	expect(asset.responded).toBe(true);
	await asset.response;
	expect(worker.puts).toEqual(["/assets/index-abc123.js"]);
});

test("activate 只清理本应用自己的旧缓存，不碰 Card 站的缓存", async () => {
	const worker = loadWorker();
	const activate = worker.listeners.get("activate");
	if (!activate) throw new Error("worker 没有注册 activate 监听");
	let pending: Promise<unknown> | undefined;
	activate({
		request: { url: "https://console.test/console/" },
		respondWith: () => {},
		waitUntil: (promise) => {
			pending = promise;
		},
	});
	await pending;
	expect(worker.deleted).toEqual(["yonder-console-assets-v0"]);
});

test("worker 不导航、不重载客户端，因此更新不会循环", () => {
	expect(source).not.toMatch(/clients\.matchAll/);
	expect(source).not.toMatch(/\.navigate\(/);
	expect(source).not.toMatch(/location\.reload/);
	expect(source).not.toMatch(/location\.href\s*=/);
	expect(source).not.toMatch(/controllerchange/);
});

test("manifest 用相对地址跟随网关注入的 base href", () => {
	const manifest = JSON.parse(readFileSync(new URL("../public/manifest.webmanifest", import.meta.url), "utf8")) as {
		start_url: string;
		scope: string;
		icons: { src: string }[];
	};
	expect(manifest.start_url).toBe("./");
	expect(manifest.scope).toBe("./");
	expect(manifest.icons.length).toBeGreaterThan(0);
	expect(manifest.icons.every((icon) => icon.src.startsWith("./"))).toBe(true);
});

test("pwa 按 base href 注册 worker，不硬编码 /，也不在 controllerchange 时刷新", async () => {
	const register = vi.fn().mockResolvedValue({});
	vi.stubGlobal("navigator", { serviceWorker: { register } });
	vi.stubGlobal("document", { baseURI: "https://console.test/console/" });
	try {
		const { registerConsoleWorker } = await import("../src/pwa");
		registerConsoleWorker();
		expect(register).toHaveBeenCalledTimes(1);
		const [script, options] = register.mock.calls[0] as [URL, Record<string, unknown>];
		expect(String(script)).toBe("https://console.test/console/yonder-sw.js");
		expect(options).toEqual({ scope: "/console/", updateViaCache: "none" });
	} finally {
		vi.unstubAllGlobals();
	}
});

test("pwa 在本机 basePath=/ 下注册根 scope，且注册失败不抛出", async () => {
	const register = vi.fn().mockRejectedValue(new Error("offline"));
	vi.stubGlobal("navigator", { serviceWorker: { register } });
	vi.stubGlobal("document", { baseURI: "http://127.0.0.1:18787/" });
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	try {
		const { registerConsoleWorker } = await import("../src/pwa");
		expect(() => registerConsoleWorker()).not.toThrow();
		const [script, options] = register.mock.calls[0] as [URL, Record<string, unknown>];
		expect(String(script)).toBe("http://127.0.0.1:18787/yonder-sw.js");
		expect(options).toEqual({ scope: "/", updateViaCache: "none" });
		await Promise.resolve();
		expect(warn).toHaveBeenCalled();
	} finally {
		warn.mockRestore();
		vi.unstubAllGlobals();
	}
});

test("pwa 在不支持 serviceWorker 的浏览器里直接返回", async () => {
	vi.stubGlobal("navigator", {});
	vi.stubGlobal("document", { baseURI: "https://console.test/console/" });
	try {
		const { registerConsoleWorker } = await import("../src/pwa");
		expect(() => registerConsoleWorker()).not.toThrow();
	} finally {
		vi.unstubAllGlobals();
	}
});
