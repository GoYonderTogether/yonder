import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { openKernel } from "../../packages/local-host/dist/kernel/index.js";
import { Runtime } from "../../packages/runtime-adapter/dist/index.js";
import { modelTransport } from "./transport.mjs";

const directory = await mkdtemp(join(tmpdir(), "yonder-zero-environment-"));
const transport = await modelTransport();
const model = "rightapi-glm/glm-5.3-flash";
const environment = Runtime.prototype.environment;
let selected;
Runtime.prototype.environment = function (config) {
	selected = environment.call(this, config);
	return selected;
};
let kernel;
try {
	await mkdir(join(directory, "agents/main"), { recursive: true });
	await writeFile(
		join(directory, "auth.json"),
		JSON.stringify({ "rightapi-glm": { type: "api_key", key: "loopback-transport-only" } }),
		{ mode: 0o600 },
	);
	await writeFile(
		join(directory, "yonder.yaml"),
		JSON.stringify({
			schema: 1,
			defaultModel: model,
			credentials: "auth.json",
			plugins: [{ use: "@yonder/plugin-agent-presets" }],
			agents: [{ id: "main", workspace: "agents/main" }],
			identity: { persons: [{ id: "owner", name: "Owner", accounts: ["acct:console:owner"] }] },
			models: {
				chain: [],
				providers: {
					"rightapi-glm": {
						baseUrl: transport.baseUrl,
						api: "openai-completions",
						authHeader: true,
						models: [{ id: "glm-5.3-flash" }],
					},
				},
			},
			retry: { maxRetries: 0 },
			timeouts: { firstTokenMs: 2000, totalMs: 5000 },
		}),
	);
	await writeFile(
		join(directory, "agents/main/agent.yaml"),
		JSON.stringify({
			schema: 1,
			id: "main",
			name: "小未",
			owner: "person:owner",
			defaultProfile: "default",
			profiles: {
				default: {
					model,
					capabilities: [],
					plugins: ["agent-presets"],
					contexts: ["default-agent-soul", "default-agent-work"],
				},
			},
			bindings: [
				{ id: "owner", match: { channel: "console", kind: "dm", from: "owner" }, session: "main", profile: "default" },
			],
		}),
	);
	kernel = await openKernel(directory, { environment: "none" });
	const input = await kernel.bots.send("main", "Reply with a short acknowledgement.");
	let end;
	for (let index = 0; index < 300; index++) {
		end = (await kernel.events.query({ type: "run.end", limit: 100 })).events.find((event) =>
			event.data.inputs?.includes(input.event),
		);
		if (end) break;
		await pause(20);
	}
	assert.equal(end?.data.status, "done");
	assert.equal(transport.requests().length, 1);
	assert.equal(selected?.id, "none");
	const context = { clock: { now: Date.now }, abortSignal: new AbortController().signal };
	const fs = await selected.readTextFile(join(directory, "yonder.yaml"), context);
	assert.equal(fs.ok, false);
	assert.equal(fs.error.code, "not_supported");
	const exec = await selected.exec("echo should-not-execute", {}, context);
	assert.equal(exec.ok, false);
	assert.equal(exec.error.code, "shell_unavailable");
	console.log(
		JSON.stringify({
			host: "local",
			entry: "openKernel → createBot → Runtime",
			storage: "FS + one SQLite connection",
			environment: selected.id,
			transport: "explicit loopback HTTP stub",
			modelRequests: transport.requests().length,
			result: end.data.status,
			fileAccessDenied: true,
			execDenied: true,
		}),
	);
} finally {
	await kernel?.close();
	Runtime.prototype.environment = environment;
	await transport.close();
	await rm(directory, { recursive: true, force: true });
}
