import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// base "./"：线上挂在 /console/ 下，资源一律相对路径；路由用 hash。
// 开发时把 /api 代理到本机网关（端口见 <home>/.yonder/gateway.json）。
const gateway = process.env.YONDER_GATEWAY ?? "http://127.0.0.1:18787";

export default defineConfig({
	base: "./",
	plugins: [react(), tailwindcss()],
	server: { port: 5174, proxy: { "/api": { target: gateway, ws: true } } },
});
