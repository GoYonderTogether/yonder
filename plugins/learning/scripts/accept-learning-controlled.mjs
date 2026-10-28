// Controlled HTTP protocol integration, NOT real Sol judgment/E2E.
// Only public @yonder/core; one real kernel, resident channel-cli inputs, synthetic data.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { initHome, openKernel, packageVersion } from "@yonder/core";
import { parse, stringify } from "yaml";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const pluginDir = resolve(process.env.YONDER_TEST_HERMES_PLUGIN ?? join(repo, "plugins/learning"));
const manifest = JSON.parse(await readFile(join(pluginDir, "package.json"), "utf8"));
const pluginId = manifest.yonder.id;
const root = await mkdtemp("/private/tmp/hermes-learning-controlled-"),
	home = join(root, "home");
const evidenceDir = join(home, "evidence");
await mkdir(evidenceDir, { recursive: true });
const evidence = {
	kind: "controlled HTTP protocol integration; NOT actual Sol judgment E2E",
	version: packageVersion,
	pluginDir,
	root,
	home,
	started: new Date().toISOString(),
	checkpoints: [],
	requests: [],
	logs: [],
	turns: [],
};
console.log(JSON.stringify({ home, evidence: join(evidenceDir, "result.json") }));
const name = "hermes-learned-release-checklist";
const fact = "Synthetic project release validation uses Node.js 22.";
const body =
	"# Release checklist\n\nFor a release checklist, return these steps in order: lint, test, tag.\nRead references/checks.md for the checks behind the sequence.\n";
const support = "# Release checks\n\nRun lint first, then test, and create a tag only after both checks pass.\n";
const reviewTools = [
	`${pluginId}_review_memory_read`,
	`${pluginId}_review_memory_edit`,
	`${pluginId}_review_skill_store`,
];
const json = (x) => `${JSON.stringify(x, null, 2)}\n`;
const checkpoint = (label, detail = {}) => {
	evidence.checkpoints.push({ label, time: new Date().toISOString(), ...detail });
	console.log(label);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let providerFailure;
async function until(check, label, ms = 30000) {
	const end = Date.now() + ms;
	for (;;) {
		if (providerFailure) throw providerFailure;
		const value = await check();
		if (value) return value;
		if (Date.now() > end) throw Error(`timeout: ${label}`);
		await sleep(100);
	}
}
const textOf = (m) => (typeof m?.content === "string" ? m.content : JSON.stringify(m?.content ?? ""));
const toolResult = (request, tool) => {
	const call = request.messages.flatMap((m) => m.tool_calls ?? []).findLast((c) => c.function?.name === tool);
	return call && request.messages.findLast((m) => m.role === "tool" && m.tool_call_id === call.id);
};
const parsedResult = (m) => {
	assert.ok(m, "expected actual tool result");
	let value = JSON.parse(textOf(m));
	// Native tools normally expose their JSON text directly; retain errors as hard failures.
	if (value.text && typeof value.text === "string") value = JSON.parse(value.text);
	assert.ok(!value.error, `tool error: ${JSON.stringify(value)}`);
	return value;
};
let kernel, server;
const sockets = [];
let requestId = 0;
function responseFor(request) {
	const offered = (request.tools ?? []).map((t) => t.function.name);
	const latestUser = request.messages.findLast((m) => m.role === "user");
	const isOrdinaryChild = request.messages.some(
		(m) => m.role === "user" && textOf(m).includes("CONTROLLED_UNGRANTED_CHILD"),
	);
	if (isOrdinaryChild) {
		const result = toolResult(request, reviewTools[0]);
		if (!result) return { calls: [{ name: reviewTools[0], args: { target: "memory" } }] };
		assert.match(textOf(result), /review_grant_required_or_expired/);
		assert.doesNotMatch(textOf(result), /Synthetic project release validation/);
		return { text: "CONTROLLED_UNGRANTED_DENIED" };
	}
	const reviewInput = request.messages.find(
		(m) => m.role === "user" && textOf(m).includes("You are a quiet, isolated Yonder-native learning review"),
	);
	if (reviewInput) {
		assert.deepEqual([...offered].sort(), [...reviewTools].sort(), "review offers ONLY dedicated tools");
		assert.match(textOf(reviewInput), /Focus=combined/);
		if (textOf(reviewInput).includes("CONTROLLED_LIMIT")) {
			const n = request.messages
				.flatMap((m) => m.tool_calls ?? [])
				.filter((c) => c.function.name === reviewTools[0]).length;
			return { calls: [{ name: reviewTools[0], args: { target: n % 2 ? "user" : "memory" } }] };
		}
		assert.match(JSON.stringify(request.messages), /CONTROLLED_TURN_10/);
		if (!toolResult(request, reviewTools[0]))
			return {
				calls: [
					{ name: reviewTools[0], args: { target: "memory" } },
					{ name: reviewTools[0], args: { target: "user" } },
				],
			};
		if (!toolResult(request, reviewTools[1])) {
			const calls = request.messages
				.flatMap((m) => m.tool_calls ?? [])
				.filter((c) => c.function.name === reviewTools[0]);
			const memoryCall = calls.find((c) => JSON.parse(c.function.arguments).target === "memory");
			const memory = parsedResult(request.messages.find((m) => m.role === "tool" && m.tool_call_id === memoryCall.id));
			return {
				calls: [
					{ name: reviewTools[1], args: { target: "memory", action: "add", revision: memory.revision, content: fact } },
				],
			};
		}
		parsedResult(toolResult(request, reviewTools[1]));
		const skillResult = toolResult(request, reviewTools[2]);
		if (!skillResult)
			return {
				calls: [
					{
						name: reviewTools[2],
						args: {
							action: "save",
							name,
							revision: "absent",
							description: "Release checklist",
							body: `---\nname: ${name}\ndescription: Release checklist\n---\n${body}`,
						},
					},
				],
			};
		if (textOf(skillResult).includes("body_must_exclude_frontmatter"))
			return {
				calls: [
					{
						name: reviewTools[2],
						args: {
							operations: [
								{
									action: "create",
									name,
									description: "Use when asked for the release checklist: ordered lint, test, tag checks.",
									revision: "absent",
									body,
								},
								{
									action: "write_file",
									name,
									file_path: "references/checks.md",
									revision: "absent",
									file_content: support,
								},
							],
						},
					},
				],
			};
		parsedResult(toolResult(request, reviewTools[2]));
		return { text: "CONTROLLED_REVIEW_PRIVATE: saved one durable fact and the release-checklist procedure." };
	}
	if (textOf(latestUser).includes("CONTROLLED_REUSE")) {
		// This is the native assembled new-session index, not a custom scanner or injected skill.
		assert.match(
			JSON.stringify(request.messages.filter((m) => m.role === "system" || m.role === "developer")),
			new RegExp(name),
		);
		if (!toolResult(request, "skill_view")) return { calls: [{ name: "skill_view", args: { name } }] };
		const result = textOf(toolResult(request, "skill_view"));
		const calls = request.messages.flatMap((m) => m.tool_calls ?? []).filter((c) => c.function.name === "skill_view");
		if (calls.length === 1) {
			assert.match(result, /lint, test, tag/);
			assert.match(result, /references\/checks.md/);
			return { calls: [{ name: "skill_view", args: { name, path: "references/checks.md" } }] };
		}
		assert.equal(calls.length, 2);
		assert.match(result, /Run lint first, then test/);
		return { text: "lint, test, tag" };
	}
	const turn = textOf(latestUser).match(/CONTROLLED_TURN_(\d+)/)?.[1];
	assert.ok(turn, "unexpected model request; no scripted fallback");
	return { text: `CONTROLLED_FOREGROUND_${turn}: understood.` };
}
try {
	assert.equal(
		packageVersion,
		JSON.parse(await readFile(join(repo, "package.json"), "utf8")).version,
		"run against this checkout build",
	);
	server = createServer(async (req, res) => {
		const id = ++requestId,
			received = new Date().toISOString();
		let request, answer;
		try {
			assert.equal(req.method, "POST");
			assert.equal(req.url, "/v1/chat/completions");
			let raw = "";
			for await (const chunk of req) raw += chunk;
			request = JSON.parse(raw);
			assert.equal(request.model, "gpt-6.1-sol");
			assert.equal(request.stream, true);
			answer = responseFor(request);
			evidence.requests.push({ id, received, path: req.url, request, answer });
			await writeFile(join(evidenceDir, `http-${String(id).padStart(2, "0")}.json`), json(evidence.requests.at(-1)));
			res.writeHead(200, {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
			});
			const chunk = (delta, finish_reason = null) =>
				res.write(
					`data: ${JSON.stringify({ id: `controlled-${id}`, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: request.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
				);
			chunk({ role: "assistant", content: "" });
			if (answer.calls)
				chunk({
					tool_calls: answer.calls.map((c, index) => ({
						index,
						id: `controlled_${id}_${index}`,
						type: "function",
						function: { name: c.name, arguments: JSON.stringify(c.args) },
					})),
				});
			else chunk({ content: answer.text });
			chunk({}, answer.calls ? "tool_calls" : "stop");
			res.end("data: [DONE]\n\n");
		} catch (error) {
			providerFailure = error;
			evidence.requests.push({ id, received, request, error: String(error), stack: error.stack });
			await writeFile(join(evidenceDir, `http-${String(id).padStart(2, "0")}.json`), json(evidence.requests.at(-1)));
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: { message: String(error), type: "controlled_assertion" } }));
		}
	});
	await new Promise((done, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", done);
	});
	const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
	evidence.provider = { model: "openai/gpt-6.1-sol", api: "openai-completions", baseUrl, syntheticCredential: true };
	await initHome(home, "fixture-owner", { isolated: true, model: "openai/gpt-6.1-sol" });
	// Drop only initHome's task presets in this fresh fixture: their plugin contexts
	// are intentionally absent from this minimal two-plugin integration home.
	for (const preset of ["default", "research"]) await rm(join(home, "presets", `${preset}.yaml`));
	const config = parse(await readFile(join(home, "yonder.yaml"), "utf8"));
	const workspace = join(home, "agents/hermes"),
		memoryDir = join(workspace, "memories"),
		skillDir = join(workspace, "skills");
	await mkdir(memoryDir, { recursive: true });
	await mkdir(skillDir);
	for (const file of ["MEMORY.md", "USER.md"]) await writeFile(join(memoryDir, file), "");
	config.plugins = [
		{ use: "@yonder/plugin-channel-cli" },
		{
			use: process.env.YONDER_TEST_HERMES_PLUGIN ? pluginDir : manifest.name,
			config: {
				scopes: [
					{
						agent: "hermes",
						profiles: ["default"],
						memoryDir,
						skillDir,
						learning: true,
						writeMode: "exclusive-yonder",
					},
				],
			},
		},
	];
	config.agents = [{ id: "hermes", workspace: "./agents/hermes" }];
	config.channels = { front: { type: "cli" }, reuse: { type: "cli" } };
	config.identity.persons[0].accounts = ["acct:front:local", "acct:reuse:local"];
	config.credentials = join(home, ".yonder/auth.json");
	config.models = {
		providers: {
			openai: {
				baseUrl,
				models: [
					{
						id: "gpt-6.1-sol",
						api: "openai-completions",
						baseUrl,
						reasoning: true,
						input: ["text"],
						contextWindow: 262144,
						maxTokens: 4096,
					},
				],
			},
		},
	};
	await mkdir(join(home, ".yonder"), { recursive: true });
	// Public provider facility, test-only dummy; no env/global OAuth or secret is read/copied.
	await writeFile(
		config.credentials,
		JSON.stringify({ openai: { type: "api_key", key: "controlled-local-fixture-not-a-secret" } }),
		{ mode: 0o600 },
	);
	await writeFile(join(home, "yonder.yaml"), stringify(config));
	await writeFile(
		join(workspace, "agent.yaml"),
		stringify({
			schema: 1,
			id: "hermes",
			name: "Synthetic Hermes",
			owner: "person:fixture-owner",
			defaultProfile: "default",
			defaults: {
				model: "openai/gpt-6.1-sol",
				thinking: "medium",
				plugins: [pluginId],
				contexts: ["hermes-memory"],
				skills: ["hermes-learned-*"],
				capabilities: ["read", "write"],
				tools: { offer: ["skill_view"], search: [] },
			},
			profiles: { default: { level: "standard" } },
			bindings: [
				{
					id: "fixture",
					match: { channel: ["front", "reuse"], kind: "dm", from: "owner" },
					session: { mode: "persistent", per: "conv" },
					profile: "default",
					stream: false,
				},
			],
		}),
	);
	kernel = await openKernel(home, {
		log: (level, message, data) => evidence.logs.push({ time: new Date().toISOString(), level, message, data }),
	});
	checkpoint("real openKernel started with local HTTP provider");
	const connect = async (channel) => {
		const socket = createConnection(join(home, ".yonder/plugins/channel-cli", `${channel}.sock`)),
			packets = [];
		sockets.push(socket);
		createInterface({ input: socket }).on("line", (line) => packets.push(JSON.parse(line)));
		await new Promise((done, reject) => {
			socket.once("connect", done);
			socket.once("error", reject);
		});
		return { socket, packets };
	};
	const front = await connect("front"),
		reuse = await connect("reuse");
	const allEvents = async () => (await kernel.events.query({ limit: 1000 })).events;
	async function say(client, text) {
		const start = client.packets.length;
		client.socket.write(`\u001e${JSON.stringify({ type: "input", text })}\n`);
		const receipt = await until(() => client.packets.slice(start).find((p) => p.type === "accepted"), "cli accepted");
		const event = receipt.event;
		const end = await until(
			async () =>
				(await kernel.events.query({ type: "run.end", after: event.id, limit: 100 })).events.find(
					(e) => e.parent === event.id || e.data.inputs?.includes(event.id),
				),
			"resident run.end",
		);
		assert.equal(end.data.status, "done", JSON.stringify(end.data));
		const reply = await until(() => client.packets.slice(start).find((p) => p.type === "message"), "foreground reply");
		return { event, end, text: reply.text, session: end.data.session };
	}
	const stateFile = join(home, ".yonder/plugins", pluginId, "learning-state.json");
	evidence.counterSamples = [];
	const prompts = [
		"The synthetic project release validation uses Node.js 22.",
		"For a release checklist, start with lint.",
		"Correction: run test after lint, not before it.",
		"Correction: tag comes last, after successful lint and test.",
		"Use that sequence for release-checklist questions, not a long incident story.",
		"Put optional explanations in a separate reference rather than the main checklist.",
		"A tag is appropriate only when both checks pass.",
		"Keep the reusable checklist concise and class-level.",
		"For a normal release checklist I need only the ordered steps.",
		"That release procedure is correct. The synthetic validation environment remains Node.js 22.",
	];
	for (let i = 0; i < 10; i++) {
		const turn = await say(front, `CONTROLLED_TURN_${String(i + 1).padStart(2, "0")}: ${prompts[i]}`);
		evidence.turns.push(turn);
		assert.equal(turn.event.type, "message.in");
		assert.match(turn.event.from, /^acct:/);
		assert.equal(turn.text, `CONTROLLED_FOREGROUND_${String(i + 1).padStart(2, "0")}: understood.`);
		if (i) assert.equal(turn.session, evidence.turns[0].session);
		const sample = await until(async () => {
			try {
				const s = JSON.parse(await readFile(stateFile, "utf8"));
				return s.sessions[turn.session]?.inputs.length === i + 1 ? s : false;
			} catch (e) {
				if (e.code === "ENOENT") return false;
				throw e;
			}
		}, "user input counted");
		evidence.counterSamples.push(sample);
		if (i < 9) {
			assert.equal(sample.sessions[turn.session].memory, i + 1);
			assert.equal(sample.sessions[turn.session].skills, i + 1);
		}
	}
	const parent = evidence.turns[0].session,
		parentInfo = await kernel.sessions.get(parent);
	assert.equal(parentInfo.agent, "hermes");
	assert.notEqual(parentInfo.mode, "task");
	evidence.parent = parentInfo;
	const before = await kernel.sessions.transcript(parent, { limit: 1000 });
	evidence.parentBefore = before;
	assert.equal(evidence.requests.length, 10, "no early review/no foreground tools");
	checkpoint("10 actual message.in resident user turns; 10 foreground model requests", {
		parent,
		mode: parentInfo.mode,
	});
	// Current plugin consumes/reset counters when queuing the threshold job, so
	// exact 10 need not remain observable. 1..9 + tenth input + combined launch
	// establish the threshold without relying on a transient internal snapshot.
	const state = evidence.counterSamples.at(-1);
	evidence.stateAtThreshold = state;
	assert.equal(state.sessions[parent].inputs.length, 10);
	assert.equal(state.sessions[parent].runs.length, 10);
	assert.ok([0, 10].includes(state.sessions[parent].memory));
	assert.ok([0, 10].includes(state.sessions[parent].skills));
	checkpoint("threshold evidence: counters 1..9, ten actual inputs/runs, no earlier review");
	const reviewEnd = await until(
		async () => {
			const sessions = await kernel.sessions.list({ mode: "task" });
			for (const s of sessions.filter((s) => s.parent === parent && s.profile === "hermes-learning-review")) {
				const end = (await allEvents()).find((e) => e.type === "run.end" && e.data.session === s.id);
				if (end) return { session: s, end };
			}
		},
		"automatic quiet review completes",
		75000,
	);
	evidence.review = reviewEnd;
	assert.equal(reviewEnd.end.data.status, "done", JSON.stringify(reviewEnd.end));
	const reviewTranscript = await kernel.sessions.transcript(reviewEnd.session.id, { limit: 1000 });
	evidence.reviewTranscript = reviewTranscript;
	const calls = reviewTranscript.flatMap((e) => e.tools ?? []).map((t) => t.name);
	assert.ok(calls.length >= 4);
	assert.ok(calls.every((n) => reviewTools.includes(n)));
	for (const tool of reviewTools) assert.ok(calls.includes(tool));
	assert.equal(reviewEnd.session.agent, null);
	const memory = await readFile(join(memoryDir, "MEMORY.md"), "utf8");
	assert.match(memory, new RegExp(fact.replaceAll(".", "\\.")));
	const savedBody = await readFile(join(skillDir, name, "SKILL.md"), "utf8"),
		savedSupport = await readFile(join(skillDir, name, "references/checks.md"), "utf8");
	assert.match(savedBody, /lint, test, tag/);
	assert.equal(savedSupport, support);
	assert.equal(savedBody.match(/^---$/gm).length, 2, "one frontmatter block after native repair");
	const skillCalls = reviewTranscript.flatMap((e) => e.tools ?? []).filter((t) => t.name === reviewTools[2]);
	assert.equal(skillCalls.length, 2, "bad legacy body refused then corrected through native review tool");
	evidence.saved = { memory, skill: savedBody, support: savedSupport };
	const firstReview = evidence.requests.find((r) => r.answer?.calls?.some((c) => reviewTools.includes(c.name)));
	const quietMs = Date.parse(firstReview.received) - Date.parse(evidence.turns.at(-1).end.ts);
	evidence.quietMs = quietMs;
	assert.ok(quietMs >= 14900, `quiet window ${quietMs}ms`);
	const reviewRequests = evidence.requests.filter((r) =>
		r.request?.tools?.some((t) => reviewTools.includes(t.function.name)),
	);
	assert.ok(reviewRequests.length <= 16);
	assert.ok(
		reviewRequests.every((r) => r.request.reasoning_effort === "high"),
		"fixed review high thinking reaches HTTP",
	);
	checkpoint("automatic review read/add + skill create/support succeeded through actual tools", {
		calls,
		quietMs,
		modelRequests: reviewRequests.length,
	});
	const after = await kernel.sessions.transcript(parent, { limit: 1000 });
	assert.deepEqual(after, before, "review must not mutate parent transcript");
	const events = await allEvents();
	const outbound = events.filter((e) => e.type === "message.out");
	const reviewOutbound = outbound.filter(
		(e) =>
			e.data.session === reviewEnd.session.id ||
			reviewEnd.end.data.inputs.includes(e.parent) ||
			e.data.text?.includes("CONTROLLED_REVIEW_PRIVATE"),
	);
	evidence.reviewDelivery = {
		totalMessageOut: outbound.length,
		reviewMessageOut: reviewOutbound,
		runReplied: reviewEnd.end.data.replied,
		targets: reviewEnd.end.data.targets,
	};
	assert.equal(reviewOutbound.length, 0);
	assert.equal(reviewEnd.end.data.replied, "caller");
	assert.deepEqual(reviewEnd.end.data.targets, []);
	assert.equal(front.packets.filter((p) => p.type === "message").length, 10);
	checkpoint("parent transcript unchanged; review has no message.out/source delivery");
	const recalled = await say(
		reuse,
		"CONTROLLED_REUSE: Give me the release checklist, using the available skill and its checks reference. Reply with steps only.",
	);
	evidence.reuse = recalled;
	assert.notEqual(recalled.session, parent);
	assert.equal(recalled.text, "lint, test, tag");
	const reuseTranscript = await kernel.sessions.transcript(recalled.session, { limit: 1000 });
	evidence.reuseTranscript = reuseTranscript;
	assert.equal(reuseTranscript.flatMap((e) => e.tools ?? []).filter((t) => t.name === "skill_view").length, 2);
	checkpoint(
		"same live kernel, different resident session discovers native index and skill_view reads body + support; uses steps",
		{ session: recalled.session },
	);
	// Same preset + parent metadata grant neither tool access nor a provider request.
	// Hook exceptions alone are fail-open on .04; the plugin uses public abort and
	// waits for this generation's real signal before returning from beforeRequest.
	const ordinary = await kernel.sessions.open({
		preset: "hermes-learning-review",
		parent,
		capabilities: ["read", "write"],
		close: "manual",
	});
	evidence.ordinaryChild = { session: ordinary };
	const beforeRequests = evidence.requests.length;
	const childWait = kernel.sessions
		.submit(ordinary.id, { text: "CONTROLLED_UNGRANTED_CHILD: try to read the parent memory." }, { wait: true })
		.then(
			(result) => {
				evidence.ordinaryChild.result = result;
				return true;
			},
			(error) => {
				evidence.ordinaryChild.error = String(error);
				return true;
			},
		);
	const childSettled = await Promise.race([childWait, sleep(5000).then(() => false)]);
	evidence.ordinaryChild.transcript = await kernel.sessions.transcript(ordinary.id, { limit: 1000 });
	evidence.ordinaryChild.events = (await allEvents()).filter((e) => e.data.session === ordinary.id);
	evidence.ordinaryChild.providerRequests = evidence.requests.length - beforeRequests;
	evidence.ordinaryChild.settledWithin5s = childSettled;
	assert.ok(childSettled, "ungranted child probe did not settle within 5s");
	assert.equal(evidence.ordinaryChild.providerRequests, 0, "ungranted child must never reach provider");
	assert.equal(evidence.ordinaryChild.result?.status, "aborted");
	assert.equal(evidence.ordinaryChild.transcript.flatMap((t) => t.tools ?? []).length, 0);
	checkpoint("ordinary child aborted before provider; same preset/parent acquires no review authority", {
		providerRequests: evidence.ordinaryChild.providerRequests,
	});
	await kernel.sessions.close(ordinary.id);
	evidence.events = await allEvents();
	evidence.packets = { front: front.packets, reuse: reuse.packets };
	evidence.parentAfter = await kernel.sessions.transcript(parent, { limit: 1000 });
	assert.deepEqual(evidence.parentAfter, before);
	// Separate synthetic probe: keep requesting alternating nonmutating reads.
	// Native maxTurns is only soft; the plugin must cancel before request 17.
	const priorTasks = new Set((await kernel.sessions.list({ mode: "task" })).map((s) => s.id));
	const beforeLimitRequests = evidence.requests.length;
	for (let i = 11; i <= 20; i++)
		await say(
			front,
			`CONTROLLED_TURN_${i}: ${i === 20 ? "CONTROLLED_LIMIT " : ""}Continue the already verified release workflow.`,
		);
	const limited = await until(
		async () => {
			for (const s of (await kernel.sessions.list({ mode: "task" })).filter(
				(s) => s.parent === parent && !priorTasks.has(s.id),
			)) {
				const end = (await allEvents()).find((e) => e.type === "run.end" && e.data.session === s.id);
				if (end) return { session: s, end };
			}
		},
		"hard 16-request review limit",
		75000,
	);
	const limitRequests = evidence.requests
		.slice(beforeLimitRequests)
		.filter((r) => r.request?.tools?.some((t) => reviewTools.includes(t.function.name)));
	evidence.limitProbe = {
		...limited,
		providerRequests: limitRequests.length,
		transcript: await kernel.sessions.transcript(limited.session.id, { limit: 1000 }),
	};
	assert.equal(limitRequests.length, 16, "no 17th review model request");
	assert.equal(limited.end.data.status, "aborted");
	assert.equal(evidence.limitProbe.transcript.flatMap((t) => t.tools ?? []).length, 16);
	checkpoint("hard review ceiling: exactly16 provider requests; request17 cancelled via public abort signal", {
		providerRequests: limitRequests.length,
		status: limited.end.data.status,
	});
	evidence.events = await allEvents();
	evidence.packets = { front: front.packets, reuse: reuse.packets };
	evidence.status = "passed";
} catch (error) {
	evidence.status = "failed";
	evidence.error = { message: String(error), stack: error.stack };
	process.exitCode = 1;
	console.error(error.stack);
	if (kernel) {
		try {
			evidence.events = (await kernel.events.query({ limit: 1000 })).events;
			evidence.sessions = await kernel.sessions.list({});
			for (const s of evidence.sessions) {
				evidence.failureTranscripts ??= {};
				evidence.failureTranscripts[s.id] = await kernel.sessions.transcript(s.id, { limit: 1000 });
			}
		} catch (e) {
			evidence.captureError = String(e);
		}
	}
} finally {
	for (const socket of sockets) socket.destroy();
	try {
		await kernel?.close();
	} catch (e) {
		evidence.closeError = String(e);
		process.exitCode = 1;
		evidence.status = "failed";
	}
	if (server) {
		server.closeAllConnections();
		await new Promise((done) => server.close(done));
	}
	evidence.finished = new Date().toISOString();
	evidence.exit = process.exitCode ?? 0;
	evidence.pluginSources = {};
	// The deprecated learning alias ships only index/recipe; absent files are recorded as null.
	for (const file of ["index.mjs", "review.mjs", "review-prompts.mjs", "skill-store.mjs", "store.mjs"]) {
		const bytes = await readFile(join(pluginDir, "dist", file)).catch((e) =>
			e.code === "ENOENT" ? null : Promise.reject(e),
		);
		evidence.pluginSources[file] = bytes && createHash("sha256").update(bytes).digest("hex");
	}
	evidence.notTested = [
		"actual Sol judgment/quality or Hermes upstream parity",
		"production configuration/data or real credentials",
		"preemption, restart recovery, disabled scopes, stale revisions, staging and archive safety (separate tests)",
		"OS sandbox or adversarial network/data isolation",
	];
	await writeFile(join(evidenceDir, "result.json"), json(evidence));
	console.log(
		JSON.stringify({
			status: evidence.status,
			exit: evidence.exit,
			home,
			evidence: join(evidenceDir, "result.json"),
			checkpoints: evidence.checkpoints.map((c) => c.label),
		}),
	);
}
