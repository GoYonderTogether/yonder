import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// base "./"：线上挂在 /console/ 下，资源一律相对路径；路由用 hash。
// 开发时把 /api 代理到本机网关（端口见 <home>/.yonder/gateway.json）。
const version = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version as string;
const root = new URL("../../", import.meta.url);
const origin = new URL(".yonder-install.json", root);
const commit: string | null = existsSync(new URL(".git", root))
	? execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()
	: existsSync(origin)
		? (JSON.parse(readFileSync(origin, "utf8")).commit ?? null)
		: null;

const gateway = process.env.YONDER_GATEWAY ?? "http://127.0.0.1:18787";

export default defineConfig({
	base: "./",
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
	server: { port: 5174, proxy: { "/api": { target: gateway, ws: true } } },
});
