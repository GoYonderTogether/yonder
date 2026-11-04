import { once } from "node:events";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Uses the cloud repository's existing ephemeral PostgreSQL/Redis and real server. */
export async function localCloud(workerKey, hourly = 30) {
	const root = resolve(process.env.YONDER_CLOUD_CHECKOUT ?? "../yonder-cloud-shared-core");
	const load = (file) => import(pathToFileURL(resolve(root, "server/dist/server", file)));
	const require = createRequire(resolve(root, "server/package.json"));
	const { serve } = require("@hono/node-server");
	const [{ services }, { migrate }, { createHub }, { createApp }, { attachWebSockets }, { human }, { DEFAULT_LIMITS }] =
		await Promise.all([
			load("test/services.js"),
			load("src/migrate.js"),
			load("src/hub.js"),
			load("src/app.js"),
			load("src/realtime.js"),
			load("test/chat-helpers.js"),
			load("src/config.js"),
		]);
	const previous = process.cwd();
	process.chdir(resolve(root, "server"));
	const svc = await services();
	try {
		await migrate(svc.databaseUrl);
	} catch (error) {
		await svc.close();
		throw error;
	} finally {
		process.chdir(previous);
	}
	const hub = await createHub(svc.redis);
	const origin = "http://localhost:18030";
	const deps = { ...svc, hub, origin, workerKey, limits: { ...DEFAULT_LIMITS, cloudBotRepliesPerHour: hourly } };
	const app = createApp(deps);
	const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
	const wss = attachWebSockets(server, deps);
	if (!server.listening) await once(server, "listening");
	const endpoint = `http://127.0.0.1:${server.address().port}`;
	return {
		...svc,
		hub,
		wss,
		endpoint,
		async request(path, owner, data) {
			const response = await fetch(`${endpoint}${path}`, {
				method: "POST",
				headers: { cookie: owner.cookie, origin, "content-type": "application/json" },
				body: JSON.stringify(data),
			});
			if (!response.ok) throw new Error(`Local server HTTP ${response.status} at ${path}`);
			return response.json();
		},
		async owner() {
			return human(svc.pool);
		},
		async close() {
			for (const client of wss.clients) client.terminate();
			await new Promise((done) => wss.close(done));
			server.closeAllConnections();
			await new Promise((done, reject) => server.close((error) => (error ? reject(error) : done())));
			await hub.close();
			await svc.close();
		},
	};
}
