// Child process: imports the sibling's real service launcher and backend, no protocol double.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
// app.ts resolves package metadata relative to the release layout (not source).
// Compile unchanged real sources into that layout outside the sibling checkout.
const build = mkdtempSync(join(tmpdir(), "yonder-card-backend-build-"));
try {
	execFileSync(
		process.execPath,
		[`${root}/node_modules/typescript/bin/tsc`, "-p", `${root}/tsconfig.json`, "--outDir", `${build}/dist`],
		{ stdio: "pipe" },
	);
} catch (error) {
	rmSync(build, { recursive: true, force: true });
	throw error;
}
writeFileSync(`${build}/package.json`, readFileSync(`${root}/../package.json`));
symlinkSync(`${root}/node_modules`, `${build}/node_modules`);
const fromServer = (path) =>
	import(
		pathToFileURL(
			path.startsWith("node_modules/") ? `${root}/${path}` : `${build}/dist/server/${path.replace(/\.ts$/, ".js")}`,
		).href
	);
const { services } = await fromServer("test/services.ts");
const { migrate } = await fromServer("src/migrate.ts");
const { createHub } = await fromServer("src/hub.ts");
const { createApp } = await fromServer("src/app.ts");
const { attachWebSockets } = await fromServer("src/realtime.ts");
const { serve } = await fromServer("node_modules/@hono/node-server/dist/index.mjs");
const svc = await services();
let hub, server;
try {
	await migrate(svc.databaseUrl);
	hub = await createHub(svc.redis);
	// Reserve the server port before creating origin-dependent routes.
	let app;
	server = serve({ hostname: "127.0.0.1", port: 0, fetch: (...args) => app.fetch(...args) });
	await new Promise((resolve) => server.once("listening", resolve));
	const endpoint = `http://127.0.0.1:${server.address().port}`;
	const deps = { ...svc, hub, origin: endpoint };
	app = createApp(deps);
	const wss = attachWebSockets(server, deps);
	process.stdout.write(`${JSON.stringify({ endpoint })}\n`);
	await new Promise((resolve) => {
		process.stdin.once("data", resolve);
		process.once("SIGTERM", resolve);
	});
	for (const ws of wss.clients) ws.terminate();
} finally {
	if (server) await new Promise((resolve) => server.close(resolve));
	if (hub) await hub.close();
	await svc.close();
	rmSync(build, { recursive: true, force: true });
}
