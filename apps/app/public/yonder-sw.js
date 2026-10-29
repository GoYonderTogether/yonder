// 控制台唯一的 Service Worker：只缓存带内容哈希的静态资源（网关对这些文件返回 immutable）。
// 导航、/api、/ws 与其他请求一律不拦截：页面始终由网关实时提供，新版本由 UpdateNotice 提示刷新；
// 这里从不重载或跳转页面，因此不会产生更新循环。
// 缓存名以 yonder-console- 开头，只清理自己的旧版本：同源 Card 站的 SW 及其缓存不受影响。
// 旧构建的哈希资源会留在缓存里，让未刷新的页面还能加载旧分块；等存储成为问题时再按构建清单裁剪。
const CACHE = "yonder-console-assets-v1";
// scope 取脚本所在目录：本机 basePath="/" 时为 /，云端为 /console/。
const scope = new URL("./", self.location.href);
const assets = new URL("assets/", scope).pathname;
// 相对 scope 的接口路径，以及反代未剥前缀时的绝对路径。
const bypass = [new URL("api", scope).pathname, "/api", new URL("ws", scope).pathname, "/ws"];
const under = (path, base) => path === base || path.startsWith(`${base}/`);

async function fromCache(request) {
	let cache;
	try {
		cache = await caches.open(CACHE);
		const hit = await cache.match(request);
		if (hit) return hit;
	} catch {
		// 存储不可用（隐私模式、配额）时直接走网络：缓存只是加速，不是可用性前提。
		return fetch(request);
	}
	const response = await fetch(request);
	if (response.ok) {
		// 写缓存失败不影响本次响应，下次再试。
		await cache.put(request, response.clone()).catch(() => {});
	}
	return response;
}

self.addEventListener("install", (event) => {
	event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		(async () => {
			const keys = await caches.keys().catch(() => []);
			await Promise.all(
				keys.filter((key) => key.startsWith("yonder-console-") && key !== CACHE).map((key) => caches.delete(key)),
			);
			await self.clients.claim();
		})(),
	);
});

self.addEventListener("fetch", (event) => {
	const request = event.request;
	// 非 GET 与页面导航都交给网络：控制台不缓存 HTML，避免旧页面盖住新版本。
	if (request.method !== "GET" || request.mode === "navigate" || request.destination === "document") return;
	const url = new URL(request.url);
	if (url.origin !== scope.origin) return;
	const path = url.pathname;
	if (bypass.some((base) => under(path, base))) return;
	// 只接管 scope 下的 assets/；其他静态文件（manifest、图标、version.json）不缓存。
	if (!path.startsWith(assets)) return;
	event.respondWith(fromCache(request));
});
