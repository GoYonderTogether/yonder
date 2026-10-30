import { execFileSync, spawn } from "node:child_process";
import {
	cpSync,
	createReadStream,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

// Frontend only: the cloud keeps serving its existing API, WebSockets and console.
const root = fileURLToPath(new URL("../", import.meta.url));
const staging = resolve(root, "../../.build/web-live/staging");
const published = resolve(root, "../../.build/web-live/published");
const mime = {
	".html": "text/html",
	".js": "text/javascript",
	".css": "text/css",
	".svg": "image/svg+xml",
	".woff2": "font/woff2",
	".json": "application/json",
	".webmanifest": "application/manifest+json",
	".png": "image/png",
	".jpg": "image/jpeg",
	".webp": "image/webp",
};
const server = createServer((req, res) => {
	let file;
	try {
		const path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
		file = resolve(published, path === "/" ? "index.html" : `.${path}`);
		if (!file.startsWith(`${published}/`)) throw Error("Not found");
		if (!existsSync(file) && !extname(path)) file = resolve(published, "index.html");
		if (!statSync(file).isFile()) throw Error("Not found");
	} catch {
		res.writeHead(404).end();
		return;
	}
	res.writeHead(200, {
		"Content-Type": mime[extname(file)] ?? "application/octet-stream",
		"Cache-Control": file.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
	});
	if (req.method === "HEAD") res.end();
	else createReadStream(file).pipe(res);
});

if (process.argv.includes("--check")) {
	const { strict: assert } = await import("node:assert");
	await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
	try {
		const base = `http://127.0.0.1:${server.address().port}`;
		for (const path of ["/", "/pa", "/version.json", "/yonder-sw.js"])
			assert.equal((await fetch(base + path)).status, 200, path);
		for (const path of ["/src/main.tsx", "/assets/missing.js", "/%2e%2e%2findex.html"])
			assert.equal((await fetch(base + path)).status, 404, path);
		console.log("Preview HTTP check passed: SPA, public assets, missing assets and source boundary");
	} finally {
		server.closeAllConnections();
		await new Promise((done) => server.close(done));
	}
	process.exit(0);
}

process.env.VITE_API = "http";
process.env.YONDER_APP_BASE = "/";
let tunnel;
let failed = false;
const watcher = await build({ root, build: { watch: {}, outDir: staging, emptyOutDir: true } });
watcher.on("event", (event) => {
	if (event.code === "START") failed = false;
	if (event.code === "ERROR") {
		failed = true;
		console.error(event.error);
	}
	if (event.code !== "END" || failed) return;
	try {
		execFileSync(process.execPath, [resolve(root, "scripts/check-build-api.mjs"), staging], { stdio: "inherit" });
		mkdirSync(published, { recursive: true });
		// ponytail: retain old hashes for open tabs; prune by build manifests if disk usage becomes material.
		cpSync(staging, published, { recursive: true, filter: (source) => source !== resolve(staging, "index.html") });
		const version = JSON.parse(readFileSync(resolve(staging, "version.json"), "utf8"));
		writeFileSync(
			resolve(published, "build-version.json"),
			JSON.stringify({ ...version, builtAt: new Date().toISOString(), mode: "live" }),
		);
		cpSync(resolve(staging, "index.html"), resolve(published, "index.next.html"));
		renameSync(resolve(published, "index.next.html"), resolve(published, "index.html"));
		if (!server.listening)
			server.listen(5173, "127.0.0.1", () => {
				tunnel = spawn(
					"ssh",
					[
						"-N",
						"-o",
						"BatchMode=yes",
						"-o",
						"ConnectTimeout=10",
						"-o",
						"ProxyCommand=nc -b en0 -G 15 %h %p",
						"-o",
						"ExitOnForwardFailure=yes",
						"-o",
						"ServerAliveInterval=15",
						"-o",
						"ServerAliveCountMax=3",
						"-R",
						"127.0.0.1:18052:127.0.0.1:5173",
						"zeth-root",
					],
					{ stdio: "inherit" },
				);
				tunnel.on("exit", () => process.exit(1));
				tunnel.on("error", (error) => {
					console.error(error);
					process.exit(1);
				});
			});
		console.log(`${new Date().toISOString()} Frontend published; refresh https://yonder.zethai.cn/`);
	} catch (error) {
		console.error("Preview build rejected; keeping previous page", error);
	}
});
process.on("exit", () => tunnel?.kill("SIGTERM"));
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
