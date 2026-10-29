import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

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
const social = process.env.YONDER_SOCIAL ?? "https://yonder.zethai.cn";
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
