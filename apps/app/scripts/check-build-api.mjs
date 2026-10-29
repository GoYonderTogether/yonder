#!/usr/bin/env node
// 生产构建守卫：`src/api/index.ts` 只在 `VITE_API === "http"` 时选 httpApi，其余（含未设）走内存 mock。
// mock 构建的页面照常发码、登录、新建 Bot、聊天，但全是本地假数据，并显示「本地原型模式」横幅 ——
// 2026-10-29 的云端网页就是这样上线的（JV2-J01-01）。所以生产构建产物必须过这一关：
//   - 不许再带 mock 独有的文案；
//   - 必须有真实接口的调用点（httpApi 被摇掉说明 VITE_API 没生效）。
// 用法：node scripts/check-build-api.mjs [dist 目录]，默认 ../dist。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const dist = process.argv[2] ?? new URL("../dist/", import.meta.url).pathname;

/** 只在 mock 实现/原型横幅里出现的文案。 */
const mockMarkers = ["本地原型模式", "（原型回复）"];
/** 真实接口才有的路径；mock 构建里被 tree-shaking 掉。 */
const apiMarkers = ["/auth/code/verify", "/me/default-bot"];

const walk = (dir) =>
	readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return walk(path);
		return /\.(js|html|json)$/.test(name) ? [path] : [];
	});

let files;
try {
	files = walk(dist);
} catch (error) {
	console.error(`构建检查失败：读不到产物目录 ${dist}（${error instanceof Error ? error.message : error}）`);
	process.exit(1);
}
if (files.length === 0) {
	console.error(`构建检查失败：${dist} 是空的`);
	process.exit(1);
}

const text = files.map((file) => readFileSync(file, "utf8")).join("\n");
const found = mockMarkers.filter((marker) => text.includes(marker));
const missing = apiMarkers.filter((marker) => !text.includes(marker));

if (found.length > 0) {
	console.error(`构建检查失败：产物是 mock（本地原型）构建，含「${found.join("」「")}」。`);
	console.error("用 `npm run build:web`（内部 VITE_API=http）重新构建，不要用 `npm run build` 直接发生产。");
	process.exit(1);
}
if (missing.length > 0) {
	console.error(`构建检查失败：产物里没有真实接口调用点 ${missing.join("、")}，VITE_API=http 可能没生效。`);
	process.exit(1);
}
console.log(`构建检查通过：真实 API 构建（${files.length} 个文件，${apiMarkers.join("、")} 均在）`);
