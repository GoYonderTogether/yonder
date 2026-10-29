import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { expect, test } from "vitest";
import { resolveProfile } from "../config/index.js";
import { FileCredentials } from "./credentials.js";
import { openDatabase } from "./db.js";
import { Runtime } from "./index.js";
import { buildModels } from "./models.js";

const auth = process.env.YONDER_TEST_AUTH ?? resolve(".yonder/auth.json");
const real = process.env.YONDER_TEST_REAL === "1" && existsSync(auth);

test.skipIf(!real)(
	"manual compaction exposes the real native task and produces a stored summary",
	async () => {
		const home = await mkdtemp(join(tmpdir(), "yonder-compact-"));
		const runtime = await Runtime.open({
			home,
			db: await openDatabase(`${home}/state.db`),
			config: { schema: 1, credentials: auth, compaction: { enabled: false, keepRecentTokens: 1 } },
			resolveSession: async () => ({ agent: null, profile: "compact", cwd: home, resolved: resolveProfile({}) }),
		});
		try {
			const session = await runtime.create({ agent: null, profile: "compact", cwd: home });
			expect(
				(
					await runtime.submit(session, {
						text: "Remember the word ORCHARD for this verification. Reply acknowledged.",
					})
				).status,
			).toBe("done");
			expect((await runtime.submit(session, { text: "Which word did I ask you to remember?" })).status).toBe("done");
			expect((await runtime.modelStatus(session)).compact.available).toBe(true);
			const task = await runtime.compact(session);
			expect(Number(task)).toBeGreaterThan(0);
			await expect
				.poll(async () => (await runtime.modelStatus(session)).compact.tasks.includes(task), { timeout: 60000 })
				.toBe(false);
			expect((await runtime.transcript(session)).some((entry) => entry.kind === "pi.compaction")).toBe(true);
		} finally {
			await runtime.close();
			await rm(home, { recursive: true, force: true });
		}
	},
	120000,
);

// Fault injection uses real HTTP errors; successful responses come from the real model.
test.skipIf(!real)(
	"native fallback survives restart, continues tools, resets per run and exhausts each model exactly three times",
	async () => {
		const home = await mkdtemp(join(tmpdir(), "yonder-fallback-"));
		const upstream = buildModels(new FileCredentials(auth)).getModel("openai", "gpt-6.1-sol")!.baseUrl;
		let failAll = false;
		let transientFailures = 0;
		const calls: string[] = [];
		const upstreamStatuses: Array<{ model: string; status: number; error?: string }> = [];
		const server = createServer(async (req, res) => {
			const chunks: Buffer[] = [];
			for await (const chunk of req) chunks.push(Buffer.from(chunk));
			const body = Buffer.concat(chunks);
			const model = JSON.parse(body.toString()).model as string;
			calls.push(model);
			if (transientFailures > 0) {
				transientFailures--;
				res.writeHead(501, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: { message: "501 controlled compaction outage" } }));
				return;
			}
			if (failAll || model === "gpt-6-luna") {
				res.writeHead(401, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: { message: "Authentication rejected at controlled HTTP boundary" } }));
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
				if (response.status >= 400) {
					const error = (await response.text()).replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]");
					upstreamStatuses.push({ model, status: response.status, error: error.slice(0, 400) });
					res.writeHead(response.status, { "content-type": "application/json" });
					res.end(error);
					return;
				}
				upstreamStatuses.push({ model, status: response.status });
				res.writeHead(response.status, { "content-type": response.headers.get("content-type") ?? "text/event-stream" });
				if (response.body)
					Readable.fromWeb(response.body)
						.on("error", () => res.destroy())
						.pipe(res);
				else res.end();
			} catch {
				res.destroy();
			}
		});
		await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
		const { port } = server.address() as { port: number };
		const dbPath = `${home}/state.db`;
		const config = {
			schema: 1 as const,
			credentials: auth,
			compaction: { enabled: false, keepRecentTokens: 1, reserveTokens: 16384 },
			retry: { maxRetries: 0, baseDelayMs: 400, maxDelayMs: 400 },
			models: {
				providers: {
					openai: {
						baseUrl: `http://127.0.0.1:${port}/v1`,
						modelOverrides: Object.fromEntries(
							["gpt-6-luna", "gpt-6.1-sol", "gpt-6-astra"].map((id) => [
								id,
								{
									compat: {
										supportsMidConvoEffort: false,
										supportsMaxOutputTokens: false,
										supportsExplicitPromptCacheMode: false,
									},
								},
							]),
						),
					},
				},
			},
		};
		const profile = resolveProfile({
			model: "openai/gpt-6-luna",
			fallback: { models: ["openai/gpt-6.1-sol", "openai/gpt-6-astra"] },
			level: "bypass",
			tools: { offer: ["bash"] },
		});
		const open = async () =>
			Runtime.open({
				home,
				db: await openDatabase(dbPath),
				config,
				resolveSession: async () => ({ agent: null, profile: "fallback", cwd: home, resolved: profile }),
			});
		let runtime = await open();
		try {
			const session = await runtime.create({ agent: null, profile: "fallback", cwd: home });
			const pending = runtime
				.submit(session, {
					text: `Call bash exactly once with command "printf done >> '${home}/effect'". Then reply FALLBACK_DONE.`,
				})
				.catch(() => undefined);
			await expect.poll(() => calls.length, { timeout: 30000 }).toBe(1);
			await runtime.close();
			await pending;
			runtime = await open();
			await runtime.recover();
			runtime.resume();
			await expect.poll(async () => !(await runtime.hasPendingWork(session)), { timeout: 120000 }).toBe(true);
			expect(calls.slice(0, 3)).toEqual(["gpt-6-luna", "gpt-6-luna", "gpt-6-luna"]);
			expect(
				calls.slice(3).every((model) => model === "gpt-6.1-sol"),
				JSON.stringify({ calls, upstreamStatuses }),
			).toBe(true);
			expect(await readFile(`${home}/effect`, "utf8")).toBe("done");
			expect((await runtime.transcript(session)).some((entry) => entry.text.includes("FALLBACK_DONE"))).toBe(true);
			calls.length = 0;
			const compactTask = await runtime.compact(session);
			await expect.poll(() => calls.length, { timeout: 30000 }).toBe(1);
			await runtime.close();
			runtime = await open();
			await runtime.recover();
			runtime.resume();
			await expect
				.poll(async () => (await runtime.modelStatus(session)).compact.tasks.includes(compactTask), { timeout: 60000 })
				.toBe(false);
			expect((await runtime.transcript(session)).some((entry) => entry.kind === "pi.compaction")).toBe(true);
			expect(calls.slice(0, 3)).toEqual(["gpt-6-luna", "gpt-6-luna", "gpt-6-luna"]);
			expect(
				calls.slice(3).every((model) => model === "gpt-6.1-sol"),
				JSON.stringify({ calls, upstreamStatuses }),
			).toBe(true);
			calls.length = 0;
			config.compaction.enabled = true;
			config.compaction.reserveTokens = runtime.models.getModel("openai", "gpt-6-luna")!.contextWindow - 1;
			expect(
				(await runtime.submit(session, { text: "Reply briefly that the previous task is complete." })).status,
			).toBe("done");
			expect(calls.slice(0, 3)).toEqual(["gpt-6-luna", "gpt-6-luna", "gpt-6-luna"]);
			expect(
				calls.slice(3).every((model) => model === "gpt-6.1-sol"),
				JSON.stringify({ calls, upstreamStatuses }),
			).toBe(true);
			config.compaction.enabled = false;
			failAll = true;
			calls.length = 0;
			const failed = await runtime.submit(session, { text: "Check availability." });
			expect(failed.status).toBe("error");
			expect(failed.reason).toContain("fallback chain exhausted");
			expect(calls).toEqual([
				"gpt-6-luna",
				"gpt-6-luna",
				"gpt-6-luna",
				"gpt-6.1-sol",
				"gpt-6.1-sol",
				"gpt-6.1-sol",
				"gpt-6-astra",
				"gpt-6-astra",
				"gpt-6-astra",
			]);
			calls.length = 0;
			const abortSession = await runtime.create({ agent: null, profile: "fallback", cwd: home });
			const abortRun = runtime.submit(abortSession, { text: "Check availability." });
			await expect.poll(() => calls.length).toBe(1);
			const status = await runtime.modelStatus(abortSession);
			expect(status.failures).toBe(1);
			await runtime.abort(abortSession);
			expect((await abortRun).status).toBe("aborted");
			expect(calls).toHaveLength(1);
			calls.length = 0;
			const failedCompact = await runtime.compact(session);
			await expect
				.poll(async () => (await runtime.modelStatus(session)).compact.tasks.includes(failedCompact), {
					timeout: 60000,
				})
				.toBe(false);
			expect((await runtime.modelStatus(session)).compact.failure).toContain(
				"Model fallback chain exhausted (3 consecutive failures per model)",
			);
			expect(calls).toEqual([
				"gpt-6-luna",
				"gpt-6-luna",
				"gpt-6-luna",
				"gpt-6.1-sol",
				"gpt-6.1-sol",
				"gpt-6.1-sol",
				"gpt-6-astra",
				"gpt-6-astra",
				"gpt-6-astra",
			]);
			const attempts = (await runtime.transcript(session)).filter((entry) => entry.kind === "pi.model-attempt");
			expect(attempts.length).toBeGreaterThanOrEqual(9);
			// Recover the same history after the outage; no new user input is needed for manual compaction.
			failAll = false;
			const recoveredCompact = await runtime.compact(session);
			await expect
				.poll(async () => (await runtime.modelStatus(session)).compact.tasks.includes(recoveredCompact), {
					timeout: 60000,
				})
				.toBe(false);
			expect((await runtime.modelStatus(session)).compact.failure).toBeUndefined();
			// No fallback: the same transient classifier and retry budget apply to summaries.
			delete profile.fallback;
			profile.model = "openai/gpt-6.1-sol";
			config.retry.maxRetries = 1;
			await runtime.close();
			runtime = await open();
			await runtime.recover();
			runtime.resume();
			await runtime.submit(session, { text: "Remember that recovery preserves our original task. Reply briefly." });
			calls.length = 0;
			transientFailures = 1;
			const retryCompact = await runtime.compact(session);
			await expect
				.poll(async () => (await runtime.modelStatus(session)).compact.tasks.includes(retryCompact), { timeout: 60000 })
				.toBe(false);
			expect((await runtime.modelStatus(session)).compact.failure).toBeUndefined();
			expect(calls).toEqual(["gpt-6.1-sol", "gpt-6.1-sol"]);
		} finally {
			await runtime.close();
			server.closeAllConnections();
			await new Promise<void>((done) => server.close(() => done()));
			await rm(home, { recursive: true, force: true });
		}
	},
	180000,
);
