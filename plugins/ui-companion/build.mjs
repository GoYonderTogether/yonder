import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(dir, "../..");
const dist = join(dir, "dist");
const web = join(dir, "web");
await mkdir(dist, { recursive: true });
const [template, style, brand, state, app] = await Promise.all([
	readFile(join(web, "index.html"), "utf8"),
	readFile(join(web, "style.css"), "utf8"),
	readFile(join(root, "brand/src/yonder-mark.js"), "utf8"),
	readFile(join(web, "state.mjs"), "utf8"),
	readFile(join(web, "app.js"), "utf8"),
]);
// Build from the shared brand source; no fork of the logo or its motion.
const script = [brand, state, app]
	.join("\n")
	.replace(/^import[\s\S]*?;\r?\n/gm, "")
	.replace(/^export /gm, "");
const font = await readFile(join(web, "assets/geist-latin-wght-normal.woff2"));
const html = template
	.replace("/* STYLES */", () => style.replace("/* GEIST */", font.toString("base64")))
	.replace("/* SCRIPT */", () => script);
await writeFile(join(dist, "index.html"), html);
console.log(`Web preview: ${join(dist, "index.html")}`);

if (process.argv.includes("--native")) {
	if (process.platform !== "darwin") {
		console.log("Native host skipped: macOS only.");
	} else {
		const bundle = join(dist, "Yonder UI.app/Contents");
		await mkdir(join(bundle, "MacOS"), { recursive: true });
		await mkdir(join(bundle, "Resources"), { recursive: true });
		await writeFile(join(bundle, "Resources/index.html"), html);
		for (const name of ["menubar-template.png", "menubar-template@2x.png"])
			await copyFile(join(root, "brand/assets/macos", name), join(bundle, "Resources", name));
		await copyFile(join(root, "brand/assets/png/yonder-mark-512.png"), join(bundle, "Resources/dock-mark.png"));
		await writeFile(
			join(bundle, "Info.plist"),
			`<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>YonderUI</string>
<key>CFBundleIdentifier</key><string>dev.yonder.ui-companion</string>
<key>CFBundleName</key><string>Yonder UI</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.1</string>
<key>LSUIElement</key><true/>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>`,
		);
		const result = spawnSync(
			"/usr/bin/swiftc",
			[
				"-module-cache-path",
				join(tmpdir(), "yonder-ui-swift-cache"),
				join(dir, "native/Companion.swift"),
				"-o",
				join(bundle, "MacOS/YonderUI"),
			],
			{ stdio: "inherit" },
		);
		if (result.error) throw result.error;
		if (result.status !== 0) process.exit(result.status ?? 1);
		console.log(`Native app: ${dirname(bundle)}`);
	}
}
if (process.argv.includes("--serve")) {
	const server = createServer(async (request, response) => {
		const address = server.address();
		if (request.headers.host !== `127.0.0.1:${address.port}` && request.headers.host !== `localhost:${address.port}`) {
			response.writeHead(403).end();
			return;
		}
		if (request.url !== "/" && request.url !== "/index.html") {
			response.writeHead(404).end();
			return;
		}
		response.writeHead(200, {
			"Content-Type": "text/html; charset=utf-8",
			"Cache-Control": "no-store",
			"X-Content-Type-Options": "nosniff",
		});
		response.end(await readFile(join(dist, "index.html")));
	});
	server.listen(62735, "127.0.0.1", () => {
		console.log(`Preview ready: http://127.0.0.1:${server.address().port}`);
	});
}
