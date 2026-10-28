// Targeted optional acceptance with a real model and read-only external Hermes candidate.
// YONDER_TEST_AUTH is a native Harness credential-file reference, never copied/read here.
// HERMES_CANDIDATE_ROOT must be the clean candidate checkout; no production channel is used.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { initHome, openKernel } from "@yonder/core";
import { parse, stringify } from "yaml";

const candidateCommit = "cf40886c8160f16a42698fb8bfd22327ad87aac6";
const candidate = process.env.HERMES_CANDIDATE_ROOT;
const auth = process.env.YONDER_TEST_AUTH;
assert.ok(candidate && auth, "Set HERMES_CANDIDATE_ROOT and YONDER_TEST_AUTH");
const git = (...args) => execFileSync("git", ["-C", candidate, ...args], { encoding: "utf8" }).trim();
assert.equal(git("rev-parse", "HEAD"), candidateCommit);
assert.equal(git("status", "--porcelain"), "", "Candidate must be clean; it is only read");
await access(auth);
const home = await mkdtemp("/tmp/yonder-slash-refine-");
const evidence = join(home, "evidence");
await mkdir(evidence);
const result = {
	kind: "real native CLI test channel and model; isolated fixture, NOT production owner/Feishu E2E",
	home,
	candidate,
	candidateCommit,
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
	await initHome(home, "isolated-slash-user", { isolated: true, model: "openai/gpt-6.1-sol" });
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
			use: join(candidate, "packages/learning"),
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
					plugins: ["learning", "slash-audit"],
					contexts: [],
					skills: [],
					tools: { offer: ["learning_refine"], search: [] },
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
	assert.equal(tools.filter((tool) => tool.name === "learning_refine").length, 1);
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
	const call = hooks.find((h) => h.phase === "beforeTool" && h.call.name === "learning_refine");
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
	result.checks.backgroundReview = "not rerun; kernel closed before quiet review timer (routing reachability scope)";
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
	result.logs = logs;
	result.candidateUnchanged = git("rev-parse", "HEAD") === candidateCommit && git("status", "--porcelain") === "";
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
