// Real Sol native channel -> /refine -> quiet review, using an extracted official npm pack.
// Adapted from accept-plugin-slash-routing.mjs; no controlled provider or production input.
// YONDER_TEST_AUTH is a native Harness credential-file reference, never copied/read here.
// HERMES_PACKED_ROOT must point to the extracted package from this checkout.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { initHome, openKernel, packageVersion } from "@yonder/core";
import { parse, stringify } from "yaml";

const packed = process.env.HERMES_PACKED_ROOT;
const auth = process.env.YONDER_TEST_AUTH;
assert.ok(packed && auth, "Set HERMES_PACKED_ROOT and YONDER_TEST_AUTH");
const pluginDir = resolve(packed);
const manifest = JSON.parse(await readFile(join(pluginDir, "package.json"), "utf8"));
assert.equal(manifest.name, "@yonder/plugin-learning");
const id = manifest.yonder.id;
assert.equal(manifest.version, packageVersion);
await access(auth);
const home = await mkdtemp("/tmp/yonder-official-refine-");
const evidence = join(home, "evidence");
await mkdir(evidence);
const result = {
	kind: "real native CLI test channel and model; isolated fixture, NOT production owner/Feishu E2E",
	home,
	pluginDir,
	version: packageVersion,
	manifest,
	entrySha256: createHash("sha256")
		.update(await readFile(join(pluginDir, "dist/index.mjs")))
		.digest("hex"),
	model: "openai/gpt-6.1-sol",
	thinking: "high",
	checks: {},
};
const save = (name, value) => writeFile(join(evidence, name), `${JSON.stringify(value, null, 2)}\n`);
const until = async (fn, label, ms = 120000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await fn();
		if (value) return value;
		if (Date.now() > deadline) throw new Error(`timeout: ${label}`);
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
};
let kernel;
const sockets = [];
const logs = [];
console.log(JSON.stringify({ home, evidence }));
try {
	await initHome(home, "isolated-slash-user", { isolated: true });
	await rm(join(home, "presets"), { recursive: true });
	const workspace = join(home, "agents/main");
	const memoryDir = join(workspace, "memories");
	const skillDir = join(workspace, "skills");
	await mkdir(memoryDir);
	await mkdir(skillDir);
	for (const name of ["MEMORY.md", "USER.md"]) await writeFile(join(memoryDir, name), "");
	const audit = join(home, "audit");
	await mkdir(audit);
	await writeFile(
		join(audit, "package.json"),
		JSON.stringify({
			name: "slash-audit",
			version: "0.0.0",
			type: "module",
			yonder: { apiVersion: 1, id: "slash-audit", entry: "./index.mjs", contributes: { hooks: ["audit"] } },
		}),
	);
	await writeFile(
		join(audit, "index.mjs"),
		`import {appendFile} from 'node:fs/promises';
const capture = (phase,ctx,extra={}) => appendFile(${JSON.stringify(join(evidence, "hooks.jsonl"))},JSON.stringify({phase,agent:ctx.agent,profile:ctx.profile,session:ctx.session,events:ctx.events,event:ctx.event,...extra})+'\\n');
export default {setup(api){api.hooks.register({id:'audit',async beforeRequest(messages,ctx){await capture('beforeRequest',ctx,{messages});},async beforeTool(call,ctx){await capture('beforeTool',ctx,{call});}});}};`,
	);
	const config = parse(await readFile(join(home, "yonder.yaml"), "utf8"));
	config.credentials = resolve(auth);
	config.plugins = [
		{ use: "@yonder/plugin-channel-cli" },
		{
			use: pluginDir,
			config: {
				scopes: [
					{ agent: "main", profiles: ["source"], memoryDir, skillDir, learning: true, writeMode: "exclusive-yonder" },
				],
			},
		},
		{ use: audit },
	];
	config.channels = { allowed: { type: "cli" }, unbound: { type: "cli" } };
	config.identity.persons[0].accounts = ["acct:allowed:local"];
	await writeFile(join(home, "yonder.yaml"), stringify(config));
	await writeFile(
		join(workspace, "agent.yaml"),
		stringify({
			schema: 1,
			id: "main",
			name: "Isolated slash acceptance",
			owner: "person:isolated-slash-user",
			defaultProfile: "source",
			profiles: {
				source: {
					model: result.model,
					thinking: result.thinking,
					capabilities: ["read", "write"],
					plugins: [id, "slash-audit"],
					contexts: [],
					skills: [],
					tools: { offer: [`${id}_refine`], search: [] },
					instructions:
						"This is an isolated routing acceptance fixture, not a real owner conversation. For the genuine /refine input, call learning_refine exactly once with focus skills. Do not call other tools. After a successful result, reply briefly. No skill or memory writing is requested.",
				},
			},
			bindings: [
				{ id: "authorized", match: { kind: "dm", from: "owner" }, session: "main", profile: "source", stream: false },
			],
		}),
	);
	kernel = await openKernel(home, { log: (level, message, data) => logs.push({ level, message, data }) });
	result.loaded = await kernel.management({ action: "plugins.show", id });
	assert.equal(result.loaded.runtimeLoaded, true);
	assert.equal(result.loaded.directory, pluginDir);
	assert.equal(result.loaded.version, packageVersion);
	result.checks.officialPackedSource = true;
	const connect = async (channel) => {
		const socket = createConnection(join(home, ".yonder/plugins/channel-cli", `${channel}.sock`));
		sockets.push(socket);
		const packets = [];
		createInterface({ input: socket }).on("line", (line) => packets.push(JSON.parse(line)));
		await new Promise((resolve, reject) => {
			socket.once("connect", resolve);
			socket.once("error", reject);
		});
		return { socket, packets };
	};
	const submit = async (client, text) => {
		const start = client.packets.length;
		client.socket.write(`\u001e${JSON.stringify({ type: "input", text })}\n`);
		return (
			await until(() => client.packets.slice(start).find((p) => p.type === "accepted"), "channel accepted", 10000)
		).event;
	};
	const allowed = await connect("allowed");
	const unbound = await connect("unbound");
	const builtin = await submit(allowed, "/help");
	await until(
		async () =>
			(await kernel.events.query({ type: "channel.command.result", after: builtin.id })).events.find(
				(e) => e.parent === builtin.id,
			),
		"builtin command",
	);
	assert.equal((await kernel.events.query({ type: "run.end" })).events.length, 0);
	result.checks.builtinNoModel = true;
	const text =
		"/refine skills\nIsolated routing acceptance only: call the attended refine tool once with focus skills and acknowledge. No new reusable lesson or file write is needed.  ";
	const rejected = await submit(unbound, text);
	assert.deepEqual(rejected.routes, [{ agent: "main", binding: null, dropped: "no-binding" }]);
	result.checks.unauthorizedNoBinding = true;
	const input = await submit(allowed, text);
	const end = await until(async () => {
		const events = (await kernel.events.query({ after: input.id, limit: 100 })).events;
		assert.ok(
			!events.some((e) => e.type.startsWith("channel.command") && e.parent === input.id),
			"unknown slash intercepted",
		);
		return events.find((e) => e.type === "run.end" && (e.parent === input.id || e.data.inputs?.includes(input.id)));
	}, "real model run.end");
	assert.equal(end.data.status, "done", JSON.stringify(end.data));
	assert.equal(end.data.model, result.model);
	assert.equal(end.data.thinking, result.thinking);
	const transcript = await kernel.sessions.transcript(input.routes[0].session, { limit: 1000 });
	await save("transcript.json", transcript);
	const tools = transcript.flatMap((item) => item.tools ?? []);
	assert.equal(tools.filter((tool) => tool.name === `${id}_refine`).length, 1);
	const replies = transcript.filter((item) => item.kind === "pi.tool-result");
	assert.ok(
		replies.some((item) => {
			try {
				const value = JSON.parse(item.text);
				return value.success === true && value.queued === true && value.attended === true;
			} catch {
				return false;
			}
		}),
		"actual Hermes attended refine success required",
	);
	const hooks = (await readFile(join(evidence, "hooks.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
	const call = hooks.find((h) => h.phase === "beforeTool" && h.call.name === `${id}_refine`);
	assert.ok(call);
	assert.equal(call.agent, "main");
	assert.equal(call.profile, "source");
	const original = call.events.find((e) => e.id === input.id);
	assert.equal(original.from, input.from);
	assert.equal(original.conv, input.conv);
	assert.equal(original.data.text, text);
	assert.equal(original.data.kind, "dm");
	assert.deepEqual(original.routes, input.routes);
	assert.ok(!hooks.some((h) => h.events?.some((e) => e.id === rejected.id)));
	result.checks.nativeModelHookOriginalContext = true;
	result.checks.actualHermesAttendedRefineSuccess = true;
	result.input = input;
	result.rejected = rejected;
	result.end = end;
	result.checks.productionOwnerAcceptance = "not performed or claimed";
	// Snapshot after the actual foreground run. Review must never append to this parent.
	const parentBefore = await kernel.sessions.transcript(end.data.session, { limit: 1000 });
	await save("parent-before.json", parentBefore);
	const review = await until(
		async () => {
			for (const session of await kernel.sessions.list({ mode: "task" })) {
				if (session.parent !== end.data.session || session.profile !== "hermes-learning-review") continue;
				const finished = (await kernel.events.query({ type: "run.end", limit: 1000 })).events.find(
					(event) => event.data.session === session.id,
				);
				if (finished) return { session, end: finished };
			}
		},
		"real Sol quiet review completion",
		240000,
	);
	result.review = review;
	assert.equal(review.session.agent, null);
	assert.equal(review.end.data.status, "done", JSON.stringify(review.end.data));
	assert.equal(review.end.data.model, result.model);
	assert.equal(review.end.data.thinking, result.thinking);
	assert.equal(review.end.data.replied, "caller");
	assert.deepEqual(review.end.data.targets, []);
	const reviewTranscript = await kernel.sessions.transcript(review.session.id, { limit: 1000 });
	await save("review-transcript.json", reviewTranscript);
	const reviewTools = reviewTranscript.flatMap((item) => item.tools ?? []);
	assert.ok(reviewTools.every((tool) => tool.name === `${id}_review_skill_store`));
	const parentAfter = await kernel.sessions.transcript(end.data.session, { limit: 1000 });
	await save("parent-after.json", parentAfter);
	assert.deepEqual(parentAfter, parentBefore);
	const events = (await kernel.events.query({ limit: 1000 })).events;
	const reviewOut = events.filter(
		(event) =>
			event.type === "message.out" &&
			(event.data.session === review.session.id || review.end.data.inputs.includes(event.parent)),
	);
	assert.deepEqual(reviewOut, []);
	// The earlier /help also has one native channel reply; it is not review output.
	assert.equal(events.filter((event) => event.type === "message.out" && event.parent === builtin.id).length, 1);
	assert.equal(events.filter((event) => event.type === "message.out" && event.parent === input.id).length, 1);
	assert.equal(allowed.packets.filter((packet) => packet.type === "message").length, 2);
	result.reviewDelivery = { reviewMessageOut: reviewOut, packets: allowed.packets, targets: review.end.data.targets };
	result.scope = { agent: "main", profiles: ["source"], memoryDir, skillDir };
	result.checks.realSolReviewCompleted = true;
	result.checks.reviewOnlyScopedSkillTools = true;
	result.checks.parentUnchanged = true;
	result.checks.noReviewOutbound = true;
	result.status = "passed";
} catch (error) {
	result.status = "failed";
	result.error = { message: String(error), stack: error.stack };
	process.exitCode = 1;
} finally {
	for (const socket of sockets) socket.destroy();
	if (kernel) {
		await save("events.json", (await kernel.events.query({ limit: 1000 })).events);
		await kernel.close();
	}
	result.cleanup = {
		socketsDestroyed: sockets.every((socket) => socket.destroyed),
		kernelClosed: true,
		serviceInstalled: false,
	};
	result.logs = logs;
	await save("result.json", result);
	console.log(
		JSON.stringify({
			status: result.status,
			evidence: join(evidence, "result.json"),
			checks: result.checks,
			error: result.error,
		}),
	);
}
