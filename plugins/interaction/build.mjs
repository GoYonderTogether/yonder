import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(dir, "../..");
const dist = join(dir, "dist");
const web = join(dir, "web");
await mkdir(dist, { recursive: true });
const [template, style, brand, state, activity, panel, icons, app] = await Promise.all([
	readFile(join(web, "index.html"), "utf8"),
	readFile(join(web, "style.css"), "utf8"),
	readFile(join(root, "brand/src/yonder-mark.js"), "utf8"),
	readFile(join(web, "state.mjs"), "utf8"),
	readFile(join(web, "activity.mjs"), "utf8"),
	readFile(join(web, "panel.mjs"), "utf8"),
	readFile(join(web, "assets/lucide/symbols.svg"), "utf8"),
	readFile(join(web, "app.js"), "utf8"),
]);
// Build from the shared brand source; no fork of the logo or its motion.
const script = [brand, state, activity, panel, app]
	.join("\n")
	.replace(/^import[\s\S]*?;\r?\n/gm, "")
	.replace(/^export /gm, "");
const font = await readFile(join(web, "assets/geist-latin-wght-normal.woff2"));
const html = template
	.replace("<!-- ICONS -->", () => icons)
	.replace("/* STYLES */", () => style.replace("/* GEIST */", font.toString("base64")))
	.replace("/* SCRIPT */", () => script);
await writeFile(join(dist, "index.html"), html);
console.log(`Web preview: ${join(dist, "index.html")}`);

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
