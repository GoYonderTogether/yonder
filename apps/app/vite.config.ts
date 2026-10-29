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

const gateway = process.env.YONDER_GATEWAY ?? "http://127.0.0.1:18787";
const social = process.env.YONDER_SOCIAL ?? "http://127.0.0.1:18030";
const toGateway = { target: gateway, ws: true };

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
			"/api/rpc": toGateway,
			"/api/stream": toGateway,
			"/api/logout": toGateway,
			// 名片站也有 /login 页面：只有登录表单的 POST 才属于网关。
			"/login": { ...toGateway, bypass: (req) => (req.method === "POST" ? undefined : req.url) },
			"/api": { target: social },
			"/ws": { target: social, ws: true },
		},
	},
});
