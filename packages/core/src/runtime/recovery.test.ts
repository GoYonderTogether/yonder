import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { resolveProfile } from "../config/index.js";
import { initHome, openKernel } from "../kernel/index.js";
import { FileCredentials } from "./credentials.js";
import { openDatabase } from "./db.js";
import { Runtime } from "./index.js";
import { buildModels } from "./models.js";
import { retryPolicy, transientModelError } from "./recovery.js";

const auth = process.env.YONDER_TEST_AUTH ?? resolve(".yonder/auth.json");
const real = process.env.YONDER_TEST_REAL === "1" && existsSync(auth);

test("retry settings default to ten patient capped backoffs and accept overrides", () => {
	expect(retryPolicy()).toEqual({ enabled: true, maxRetries: 10, baseDelayMs: 2000, maxAgentDelayMs: 300000 });
	expect(retryPolicy({ maxRetries: 0, baseDelayMs: 25, maxDelayMs: 100 })).toEqual({
		enabled: true,
		maxRetries: 0,
		baseDelayMs: 25,
		maxAgentDelayMs: 100,
	});
});

test("recovery retries transport/5xx/throttle errors and excludes deterministic failures and aborts", () => {
	for (const errorMessage of [
		"fetch failed",
		"OAuth refresh failed for openai: fetch failed",
		"OAuth refresh failed for openai: ECONNRESET",
		"Connection error.",
		"ECONNRESET",
		"501 upstream error",
		"503 overloaded",
		"429 rate limit",
	])
		expect(transientModelError({ stopReason: "error", errorMessage }), errorMessage).toBe(true);
	for (const errorMessage of [
		"401 authentication failed; please retry your request",
		"OAuth refresh failed for openai: invalid_grant; fetch failed",
		"403 permission denied",
		"400 schema error; 503 upstream",
		"422 invalid request",
		"context length exceeded",
		"insufficient_quota",
		"billing",
		"repeatStop",
		"aborted",
		"Unknown failure",
	])
		expect(transientModelError({ stopReason: "error", errorMessage }), errorMessage).toBe(false);
	expect(transientModelError({ stopReason: "aborted", errorMessage: "503" })).toBe(false);
});

// Real HTTP failures, then byte-for-byte proxying to the real configured model.
// Neither the provider stream nor pi is mocked; credentials are never logged.
test.skipIf(!real)(
	"real Luna resumes an in-flight model request and HTTP failures without replaying tools or source delivery",
	async () => {
		const home = await mkdtemp("/tmp/yonder-network-live-");
		const upstream = buildModels(new FileCredentials(auth)).getModel("openai", "gpt-6-luna")!.baseUrl;
		let calls = 0;
		const failed: number[] = [];
		const upstreamStatuses: number[] = [];
		const requests: string[] = [];
		const server = createServer(async (req, res) => {
			const chunks: Buffer[] = [];
			for await (const chunk of req) chunks.push(Buffer.from(chunk));
			const body = Buffer.concat(chunks);
			requests.push(body.toString());
			calls++;
			// Hold the initial real provider request until shutdown cancels it.
			// Its native request checkpoint must be resent on restart.
			if (calls <= 2) return;
			// The resent request executes a tool. Fail the following generation
			// twice, after its filesystem side effect has completed.
			if (calls === 4 || calls === 5) {
				failed.push(Date.now());
				// Drop the actual TCP connection once, then return a protocol overload.
				if (calls === 4) res.destroy();
				else {
					res.writeHead(503, { "content-type": "application/json" });
					res.end(JSON.stringify({ error: { message: "Upstream temporarily unavailable" } }));
				}
				return;
			}
			try {
				const headers = new Headers();
				for (const [key, value] of Object.entries(req.headers))
					if (value && !["host", "connection", "content-length"].includes(key)) headers.set(key, String(value));
				const response = await fetch(`${upstream.replace(/\/$/, "")}${req.url!.replace(/^\/v1/, "")}`, {
					method: "POST",
					headers,
					body,
				});
				upstreamStatuses.push(response.status);
				res.writeHead(response.status, { "content-type": response.headers.get("content-type") ?? "text/event-stream" });
				if (response.body) Readable.fromWeb(response.body).pipe(res);
				else res.end();
			} catch {
				res.destroy();
			}
		});
		await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
		const address = server.address() as { port: number };
		let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
		let socket: ReturnType<typeof createConnection> | undefined;
		try {
			await initHome(home);
			const config = parse(await readFile(`${home}/yonder.yaml`, "utf8"));
			config.credentials = auth;
			config.retry = { maxRetries: 3, baseDelayMs: 2000, maxDelayMs: 2100 };
			config.models = {
				providers: {
					openai: {
						baseUrl: `http://127.0.0.1:${address.port}/v1`,
						// The subscription protocol omits these fields; a loopback URL bypasses pi's hostname detection.
						modelOverrides: {
							"gpt-6-luna": {
								compat: {
									supportsMidConvoEffort: false,
									supportsMaxOutputTokens: false,
									supportsExplicitPromptCacheMode: false,
								},
							},
						},
					},
				},
			};
			await writeFile(`${home}/yonder.yaml`, stringify(config));
			const path = `${home}/agents/main/agent.yaml`;
			const agent = parse(await readFile(path, "utf8"));
			agent.defaults.contexts = [];
			agent.profiles.owner.tools = { offer: ["bash"] };
			await writeFile(path, stringify(agent));
			kernel = await openKernel(home);
			socket = createConnection(`${home}/.yonder/plugins/channel-cli/cli.sock`);
			await new Promise<void>((done, reject) => {
				socket!.once("connect", done);
				socket!.once("error", reject);
			});
			socket.write(
				`Call bash exactly once with command "printf 'done\\n' >> '${home}/effect'". Then reply exactly RECOVERY_COMPLETE. Do not repeat the command.\n`,
			);
			await expect.poll(() => calls, { timeout: 30000 }).toBe(1);
			socket.destroy();
			await kernel.close();
			kernel = await openKernel(home);
			await expect.poll(() => calls, { timeout: 30000 }).toBe(2);
			await kernel.close();
			kernel = await openKernel(home);
			const running = kernel;
			socket = createConnection(`${home}/.yonder/plugins/channel-cli/cli.sock`);
			await new Promise<void>((done, reject) => {
				socket!.once("connect", done);
				socket!.once("error", reject);
			});
			await expect
				.poll(async () => (await running.events.query({ type: "run.end" })).events.length, { timeout: 120000 })
				.toBe(1);
			expect(
				(await running.events.query({ type: "run.end" })).events[0]!.data,
				`HTTP requests: ${calls}; upstream statuses: ${upstreamStatuses}`,
			).toMatchObject({ status: "done" });
			const [session] = await running.sessions.list({});
			const transcript = await running.sessions.transcript(session!.id, { limit: 1000 });
			expect(transcript.filter((entry) => entry.kind === "yonder.runtime-note")).toHaveLength(2);
			expect(requests[1]).toContain("Task interrupted by restart");
			expect(requests[1]!.match(/Task interrupted by restart/g) ?? []).toHaveLength(1);
			expect(requests[2]!.match(/Task interrupted by restart/g) ?? []).toHaveLength(1);
			expect(requests.at(-1)).toContain("Connection to the model interrupted");
			expect(failed).toHaveLength(2);
			expect(failed[1]! - failed[0]!).toBeGreaterThanOrEqual(1900);
			expect(await readFile(`${home}/effect`, "utf8")).toBe("done\n");
			await expect
				.poll(
					async () =>
						(await running.events.query({ type: "message.out" })).events.filter((e) =>
							JSON.stringify(e.data).includes("RECOVERY_COMPLETE"),
						).length,
				)
				.toBe(1);
			const outputs = (await running.events.query({ type: "message.out" })).events;
			expect(outputs.every((event) => event.conv === "conv:cli:local")).toBe(true);
			expect((await running.events.query({ type: "run.end" })).events[0]!.data).toMatchObject({ status: "done" });
			// Replay completion recovery twice: existing receipts must not send again.
			socket.destroy();
			await kernel.close();
			kernel = await openKernel(home);
			await kernel.close();
			kernel = await openKernel(home);
			expect((await kernel.events.query({ type: "message.out" })).events).toHaveLength(outputs.length);
		} finally {
			socket?.destroy();
			await kernel?.close();
			server.closeAllConnections();
			await new Promise<void>((done) => server.close(() => done()));
			await rm(home, { recursive: true, force: true });
		}
	},
	180000,
);

test.skipIf(!real)(
	"real HTTP boundary enforces capped backoffs, retry exclusions, exhaustion and immediate abort",
	async () => {
		const home = await mkdtemp("/tmp/yonder-network-budget-");
		let status = 503;
		let errorText = "Service temporarily unavailable";
		let calls: number[] = [];
		const server = createServer((req, res) => {
			calls.push(Date.now());
			if (status === 0) {
				req.socket.destroy();
				return;
			}
			res.writeHead(status, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: { message: errorText } }));
		});
		await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
		const address = server.address() as { port: number };
		const runtime = await Runtime.open({
			home,
			db: await openDatabase(`${home}/state.db`),
			config: {
				schema: 1,
				credentials: auth,
				retry: { maxRetries: 3, baseDelayMs: 300, maxDelayMs: 400 },
				models: {
					providers: {
						openai: {
							baseUrl: `http://127.0.0.1:${address.port}/v1`,
							// The subscription protocol omits these fields; a loopback URL bypasses pi's hostname detection.
							modelOverrides: {
								"gpt-6-luna": {
									compat: {
										supportsMidConvoEffort: false,
										supportsMaxOutputTokens: false,
										supportsExplicitPromptCacheMode: false,
									},
								},
							},
						},
					},
				},
			},
			resolveSession: async () => ({ agent: null, profile: "recovery", cwd: home, resolved: resolveProfile({}) }),
		});
		const create = () => runtime.create({ agent: null, profile: "recovery", cwd: home });
		try {
			const session = await create();
			const exhausted = await runtime.submit(session, { text: "Check provider availability." });
			expect(exhausted).toMatchObject({
				status: "error",
				reason: expect.stringContaining("retries exhausted (3 retries)"),
			});
			expect(exhausted.reason).toContain("Service temporarily unavailable");
			expect(await runtime.hasPendingWork(session)).toBe(false);
			expect(calls).toHaveLength(4);
			for (let i = 1; i < calls.length; i++)
				expect(calls[i]! - calls[i - 1]!).toBeGreaterThanOrEqual(Math.min(300 * 2 ** (i - 1), 400) - 30);
			expect((await runtime.transcript(session)).filter((entry) => entry.kind === "yonder.runtime-note")).toHaveLength(
				1,
			);
			for (status of [0, 429, 500, 501, 502, 504, 529]) {
				calls = [];
				const failed = await create();
				expect((await runtime.submit(failed, { text: "Check provider availability." })).status).toBe("error");
				expect(calls).toHaveLength(4);
				expect((await runtime.transcript(failed)).filter((entry) => entry.kind === "yonder.runtime-note")).toHaveLength(
					1,
				);
			}
			for (const failure of [
				[401, "Authentication failed; please retry your request"],
				[401, "Invalid API key; 503 upstream"],
				[403, "Permission denied; overloaded"],
				[400, "Invalid schema; upstream 503"],
				[422, "Invalid request; please retry your request"],
				[400, "Context length exceeded; overloaded"],
				[400, "Token limit exceeded; 503 upstream"],
				[429, "insufficient_quota"],
				[429, "Billing limit exceeded; rate limit"],
				[503, "repeatStop"],
				[503, "aborted"],
				[503, "Authentication failed; please retry your request"],
				[503, "Invalid API key"],
				[503, "Permission denied"],
				[503, "Token limit exceeded"],
			] as const) {
				[status, errorText] = failure;
				calls = [];
				expect((await runtime.submit(await create(), { text: "Check provider availability." })).status).toBe("error");
				expect(calls).toHaveLength(1);
			}
			status = 503;
			errorText = "Service temporarily unavailable";
			calls = [];
			const aborted = await create();
			const pending = runtime.submit(aborted, { text: "Check provider availability." });
			await expect
				.poll(async () => (await runtime.transcript(aborted)).some((entry) => entry.kind === "yonder.runtime-note"))
				.toBe(true);
			const abortStarted = Date.now();
			await runtime.abort(aborted);
			expect((await pending).status).toBe("aborted");
			expect(Date.now() - abortStarted).toBeLessThan(1000);
			expect(calls).toHaveLength(1);
		} finally {
			await runtime.close();
			server.closeAllConnections();
			await new Promise<void>((done) => server.close(() => done()));
			await rm(home, { recursive: true, force: true });
		}
	},
	60000,
);

test.skipIf(!real)(
	"HTTP retry checkpoints and interruption identities survive repeated restarts",
	async () => {
		const home = await mkdtemp("/tmp/yonder-network-restart-");
		const requests: string[] = [];
		const server = createServer(async (req, res) => {
			const chunks: Buffer[] = [];
			for await (const chunk of req) chunks.push(Buffer.from(chunk));
			requests.push(Buffer.concat(chunks).toString());
			res.writeHead(503, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: { message: "Service temporarily unavailable" } }));
		});
		await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
		const address = server.address() as { port: number };
		let db = await openDatabase(`${home}/state.db`);
		const open = () =>
			Runtime.open({
				home,
				db,
				config: {
					schema: 1,
					credentials: auth,
					retry: { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 1000 },
					models: { providers: { openai: { baseUrl: `http://127.0.0.1:${address.port}/v1` } } },
				},
				resolveSession: async () => ({ agent: null, profile: "recovery", cwd: home, resolved: resolveProfile({}) }),
			});
		let runtime = await open();
		try {
			const session = await runtime.create({ agent: null, profile: "recovery", cwd: home });
			const interrupted = runtime.submit(session, { text: "Check provider availability." }).catch(() => undefined);
			await expect
				.poll(async () =>
					(await db.all<{ record: string }>("SELECT record FROM pi_tasks")).some((row) =>
						row.record.includes('"phase":"retry"'),
					),
				)
				.toBe(true);
			await runtime.close();
			await interrupted;
			db = await openDatabase(`${home}/state.db`);
			runtime = await open();
			await runtime.recover();
			runtime.resume();
			await expect.poll(() => requests.length).toBe(2);
			await runtime.close();
			db = await openDatabase(`${home}/state.db`);
			runtime = await open();
			await runtime.recover();
			runtime.resume();
			await expect.poll(async () => !(await runtime.hasPendingWork(session)), { timeout: 30000 }).toBe(true);
			expect(requests).toHaveLength(4);
			expect(requests.at(-1)).toContain("Connection to the model interrupted");
			expect(requests.at(-1)!.match(/Connection to the model interrupted/g) ?? []).toHaveLength(1);
			expect(requests.at(-1)).not.toContain("Task interrupted by restart");
			const submissions = (await db.all<{ record: string }>("SELECT record FROM pi_submissions")).map((row) =>
				JSON.parse(row.record),
			);
			expect(submissions.filter((record) => record.requestId?.startsWith("restart:"))).toHaveLength(0);
			expect((await runtime.transcript(session)).filter((entry) => entry.kind === "yonder.runtime-note")).toHaveLength(
				1,
			);
			// Restart an exhausted run twice: no new requests or notices, and no pending work.
			for (let restart = 0; restart < 2; restart++) {
				await runtime.close();
				db = await openDatabase(`${home}/state.db`);
				runtime = await open();
				await runtime.recover();
				runtime.resume();
				expect(await runtime.hasPendingWork(session)).toBe(false);
				expect(requests).toHaveLength(4);
				expect(
					(await runtime.transcript(session)).filter((entry) => entry.kind === "yonder.runtime-note"),
				).toHaveLength(1);
			}
		} finally {
			await runtime.close();
			server.closeAllConnections();
			await new Promise<void>((done) => server.close(() => done()));
			await rm(home, { recursive: true, force: true });
		}
	},
	60000,
);
