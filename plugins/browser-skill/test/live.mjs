// Opt-in REAL bsk integration via the built plugin entry, not an installed Yonder/model test.
// node plugins/browser-skill/test/live.mjs status|guide|start-daemon|page [verified-browser-id]
// BSK_TEST_EXECUTABLE may point to an already installed CLI; never installs anything.
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import plugin from "../dist/index.js";

const mode = process.argv[2];
if (!["status", "guide", "start-daemon", "page"].includes(mode))
	throw new Error("Choose status, guide, start-daemon or page");
if (mode === "page" && !process.argv[3]) throw new Error("page requires the explicitly authorized browser instance");
const directory = join(tmpdir(), "yonder-n07-source-live");
await mkdir(directory, { recursive: true });
const tools = new Map();
let lifecycle;
// This source invocation has real local environment facts but no model/runtime/session routing.
// Only id/cwd are used by this local-only adapter; it does not emulate ExecutionEnv operations.
plugin.setup({
	config: { bskPath: process.env.BSK_TEST_EXECUTABLE ?? "bsk" },
	paths: { data: join(directory, "ownership") },
	tools: {
		register(tool) {
			tools.set(tool.name, tool);
		},
	},
	skills: { register() {} },
	events: { on() {} },
	triggers: {
		register(trigger) {
			lifecycle = trigger;
		},
	},
	log: {
		warn(message, data) {
			console.error(message, data);
		},
	},
});
const controller = new AbortController();
const ctx = {
	agent: null,
	profile: "source-integration-no-model",
	session: "n07-source-live",
	capabilities: ["read", "write", "exec", "network"],
	env: { id: "node:local", cwd: process.cwd() },
	signal: controller.signal,
};
const evidence = [];
async function call(group, args, context = ctx) {
	const result = await tools.get(`browser-skill_${group}`).execute(args, context);
	const entry = {
		tool: `browser-skill_${group}`,
		args,
		text: JSON.parse(result.text),
		isError: result.isError ?? false,
	};
	if (result.images) {
		entry.images = [];
		for (const image of result.images) {
			const bytes = Buffer.from(image.data, "base64");
			const path = join(directory, `screenshot.${image.mime === "image/png" ? "png" : "image"}`);
			await writeFile(path, bytes);
			entry.images.push({
				mime: image.mime,
				bytes: bytes.length,
				sha256: createHash("sha256").update(bytes).digest("hex"),
				path,
			});
		}
	}
	evidence.push(entry);
	await writeFile(join(directory, `${mode}.json`), JSON.stringify(evidence, null, 2));
	console.log(JSON.stringify(entry));
	return result;
}
await lifecycle.start();
let request;
try {
	if (mode !== "page") {
		const result = await call("setup", { action: mode });
		if (result.isError) process.exitCode = 1;
	} else {
		const readiness = await call("setup", { action: "status" });
		if (readiness.isError || JSON.parse(readiness.text).state !== "connected")
			throw new Error("Not connected; run readiness/setup in a separate invocation first");
		const start = await call("session", { action: "start", browser: process.argv[3], noFocus: true });
		if (start.isError) throw new Error("Native session start failed");
		request = JSON.parse(start.text).request;
		for (const [group, args] of [
			["page", { action: "navigate", url: "https://example.com" }],
			["inspect", { action: "observe" }],
			["inspect", { action: "screenshot" }],
		]) {
			const result = await call(group, { ...args, session: request.session });
			if (result.isError) throw new Error(`${group}.${args.action} failed`);
		}
	}
} finally {
	if (request) {
		const stop = await call("session", { action: "stop", requestId: request.requestId });
		if (stop.isError) process.exitCode = 1;
		await call("session", { action: "list" });
	}
	await lifecycle.stop();
}
console.log(
	`Source integration evidence: ${join(directory, `${mode}.json`)}; no model or installed Yonder acceptance claimed.`,
);
