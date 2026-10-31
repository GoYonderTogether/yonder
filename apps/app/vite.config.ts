import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// base 由 YONDER_APP_BASE 决定：云端 "/"；默认 "./"，让网关在任意挂载路径（本机 "/"、对外 "/console/"）下都能用。
// 路由是 BrowserRouter，basename 取网关注入的 yonder-base-path（见 src/lib/base.ts）。
// 开发（vite dev，固定 5180）：网关接口（/api/rpc、/api/stream、/api/logout、POST /login）代理到本机网关，
// 其余 /api 与 /ws 是名片站的社交服务，代理到 YONDER_SOCIAL。
const version = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version as string;
const root = new URL("../../", import.meta.url);
const origin = new URL(".yonder-install.json", root);
const commit: string | null = existsSync(new URL(".git", root))
	? execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()
	: existsSync(origin)
		? (JSON.parse(readFileSync(origin, "utf8")).commit ?? null)
		: null;

// 网关默认指向演示实例（~/Documents/yonder-demo-fe，18795）；社交服务默认云端，二选一见 deploy/DEV.md 的做法：
// YONDER_SOCIAL=http://127.0.0.1:18030 可改用本机测试后端。
const gateway = process.env.YONDER_GATEWAY ?? "http://127.0.0.1:18795";
const social = process.env.YONDER_SOCIAL ?? "https://yonderbot.net";
/** 目标服务按 Origin 做来源检查，所以把浏览器的 Origin 改写成目标自己的。 */
const proxyTo = (target: string, ws = false) => ({
	target,
	ws,
	changeOrigin: true,
	configure: (proxy: {
		on(event: string, fn: (req: { setHeader(name: string, value: string): void }) => void): void;
	}) => {
		proxy.on("proxyReq", (req) => req.setHeader("origin", target));
		proxy.on("proxyReqWs", (req) => req.setHeader("origin", target));
	},
});

// ---- 本机预览免手动登录 ------------------------------------------------------
// 只在本机 `vite serve` 且请求来自回环地址时启用（dev-demo.sh 导出 YONDER_DEV_AUTOLOGIN=1），生产构建不加载。
// 网关：用演示实例自己的 CLI 走控制套接字签一次性票据（等同 `yonder ui` 打印的链接），换成会话 cookie 后下发；
// 浏览器带着这张 cookie 请求 /api/rpc、/api/stream，代理转发过去就是登录态。票据/令牌都不进日志。
// 社交：默认原型数据（VITE_API 未设），把 mock 的会话初始值预置成原型登录一次之后的样子。
// cookie 名与网关 packages/gateway/src/auth.ts 的 COOKIE 一致，app 不依赖网关包，这里单独写一份。
const DEV_COOKIE = "yonder_session";
const devHome = process.env.YONDER_DEV_HOME;
const devCli = process.env.YONDER_DEV_CLI;
const autoLogin = process.env.YONDER_DEV_AUTOLOGIN === "1" && !!devHome && !!devCli && existsSync(devCli);
const prototypeLogin = autoLogin && process.env.VITE_API !== "http";
const isLoopbackPeer = (address: string | undefined) =>
	address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";

/** 走演示实例的控制套接字签一张一次性票据，返回兑换用链接。 */
function mintTicket(): string {
	const out = execFileSync(process.execPath, [devCli as string, "ui"], {
		env: { ...process.env, YONDER_HOME: devHome as string },
		encoding: "utf8",
		timeout: 10_000,
	});
	const token = /[?&]token=([A-Za-z0-9_-]+)/.exec(out)?.[1];
	if (!token) throw new Error("yonder ui 没有打印登录链接");
	return `${gateway}/?token=${token}`;
}

/** 票据换会话 cookie；Path 跟网关的挂载路径走（对外是 /console/，本机是 /），这里统一改成根路径。 */
async function mintCookie(): Promise<string> {
	const response = await fetch(mintTicket(), { redirect: "manual" });
	const raw = response.headers.getSetCookie().find((value) => value.startsWith(`${DEV_COOKIE}=`));
	if (!raw) throw new Error(`网关没有返回 ${DEV_COOKIE} cookie`);
	const [pair, ...attributes] = raw.split(";");
	const keep = attributes.map((a) => a.trim()).filter((a) => a && !/^path=/i.test(a) && !/^domain=/i.test(a));
	return [pair, "Path=/", ...keep].join("; ");
}

/** 只读探测登录态：未登录时网关根路径 303 跳 /login，已登录直接给页面。 */
async function loggedIn(value: string): Promise<boolean> {
	const response = await fetch(`${gateway}/`, { redirect: "manual", headers: { cookie: `${DEV_COOKIE}=${value}` } });
	return response.status < 300 || response.status >= 400;
}

const cookieValue = (header: string | undefined) =>
	header
		?.split(";")
		.map((part) => part.trim().split("="))
		.find(([name]) => name === DEV_COOKIE)?.[1];

/** 每次整页加载检查一次：缺 cookie 或已过期，就换一张新票据（过期后刷新即恢复，无需手动登录）。 */
const gatewayAutoLogin = (): Plugin => ({
	name: "yonder-dev-gateway-login",
	apply: "serve",
	configureServer(server) {
		server.middlewares.use((req, res, next) => {
			const html = String(req.headers.accept ?? "").includes("text/html");
			const page = req.method === "GET" || req.method === "HEAD";
			if (!html || !page || !isLoopbackPeer(req.socket.remoteAddress)) return next();
			void (async () => {
				try {
					const current = cookieValue(req.headers.cookie);
					if (current && (await loggedIn(current))) return;
					res.setHeader("set-cookie", await mintCookie());
				} catch (error) {
					server.config.logger.warn(`[dev-login] 网关自动登录失败：${(error as Error).message}`);
				}
			})().finally(next);
		});
	},
});

/** 原型数据模式下 mock 的会话初始值 = 原型登录一次的结果（{ actor: me }）；只影响 dev，不改仓库源码。 */
const MOCK_SESSION_INIT = "let session: Session | null = null;";
const prototypeAutoLogin = (): Plugin => ({
	name: "yonder-dev-prototype-login",
	apply: "serve",
	enforce: "pre",
	transform(code, id) {
		if (!id.endsWith("/src/api/mock.ts")) return;
		if (!code.includes(MOCK_SESSION_INIT)) throw new Error("原型预置会话失效：mock.ts 的 session 初始化写法变了");
		return code.replace(
			MOCK_SESSION_INIT,
			'let session: Session | null = { actor: { id: "u-me", kind: "human", name: "我" } };',
		);
	},
});

export default defineConfig({
	base: process.env.YONDER_APP_BASE ?? "./",
	plugins: [
		react(),
		tailwindcss(),
		{
			name: "build-version",
			generateBundle() {
				this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ version, commit }) });
			},
		},
		...(autoLogin ? [gatewayAutoLogin()] : []),
		...(prototypeLogin ? [prototypeAutoLogin()] : []),
	],
	define: {
		"import.meta.env.VITE_BUILD_VERSION": JSON.stringify(version),
		"import.meta.env.VITE_BUILD_COMMIT": JSON.stringify(commit),
	},
	server: {
		port: 5180,
		strictPort: true,
		proxy: {
			"/api/rpc": proxyTo(gateway),
			"/api/stream": proxyTo(gateway, true),
			"/api/logout": proxyTo(gateway),
			// 名片站也有 /login 页面：只有登录表单的 POST 才属于网关。
			"/login": { ...proxyTo(gateway), bypass: (req) => (req.method === "POST" ? undefined : req.url) },
			"/api": proxyTo(social),
			"/ws": proxyTo(social, true),
		},
	},
});
