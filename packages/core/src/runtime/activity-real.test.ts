import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { expect, test } from "vitest";
import { parseAgentConfig, resolveProfile } from "../config/index.js";
import { terminalApi } from "../kernel/terminal.js";
import { createStore, type Store } from "../store/index.js";
import { FileCredentials } from "./credentials.js";
import { openDatabase } from "./db.js";
import { Runtime } from "./index.js";
import { buildModels } from "./models.js";

const auth = process.env.YONDER_TEST_AUTH ?? resolve(".yonder/auth.json");
const real = process.env.YONDER_TEST_REAL === "1" && existsSync(auth);

// Same real HTTP failure boundary as recovery.test.ts. Successful output is streamed
// byte-for-byte from the configured real model; no model implementation is replaced.
test.skipIf(!real)(
	"real retry, parallel normal priority, success, fallback and cancellation project current facts only",
	async () => {
		const home = await mkdtemp("/tmp/yonder-activity-http-");
		const upstream = buildModels(new FileCredentials(auth)).getModel("openai", "gpt-6-luna")!.baseUrl;
		let mode: "retry" | "fallback" | "fail" | "success" = "retry";
		let calls = 0;
		let holdPeer = false;
		let peerId: string | undefined;
		let releasePeer!: () => void;
		const peerGate = new Promise<void>((done) => {
			releasePeer = done;
		});
		const server = createServer(async (req, res) => {
			const chunks: Buffer[] = [];
			for await (const chunk of req) chunks.push(Buffer.from(chunk));
			const body = Buffer.concat(chunks);
			const model = JSON.parse(body.toString()).model as string;
			calls++;
			if (mode === "fail" || (mode === "retry" && calls === 1) || (mode === "fallback" && model === "gpt-6-luna")) {
				res.writeHead(mode === "fallback" ? 401 : 503, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: { message: "controlled upstream outage; private-error-marker" } }));
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
		const profile = resolveProfile({ model: "openai/gpt-6-luna", tools: { offer: [] } });
		const config = {
			schema: 1 as const,
			credentials: auth,
			retry: { maxRetries: 1, baseDelayMs: 800, maxDelayMs: 800 },
			models: {
				providers: {
					openai: {
						baseUrl: `http://127.0.0.1:${port}/v1`,
						modelOverrides: Object.fromEntries(
							["gpt-6-luna", "gpt-6.1-sol"].map((id) => [
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
		let store: Store;
		const open = async () => {
			const db = await openDatabase(`${home}/state.db`);
			store = await createStore(db);
			return Runtime.open({
				home,
				db,
				config,
				resolveSession: async () => ({ agent: "main", profile: "activity", cwd: home, resolved: profile }),
				sections: async (session) => {
					if (holdPeer && session.id === peerId) await peerGate;
					return [];
				},
			});
		};
		let runtime = await open();
		const agent = parseAgentConfig(
			"schema: 1\nid: main\nname: Main\nowner: person:owner\ndefaultProfile: owner\nprofiles:\n  owner: {}\nbindings: []\n",
		);
		const activity = () =>
			terminalApi({ agents: new Map([["main", agent]]), store, sessions: {}, runtime: () => runtime } as Parameters<
				typeof terminalApi
			>[0]).activity();
		const create = async () => {
			const id = await runtime.create({ agent: "main", profile: "activity", cwd: home });
			await store.sessions.put({
				id,
				agent: "main",
				profile: "activity",
				mode: "persistent",
				key: id,
				version: "activity-test",
				opened: new Date().toISOString(),
			});
			return id;
		};
		try {
			const session = await create();
			const pending = runtime.submit(session, { text: "Reply briefly with the word recovered. Do not call tools." });
			await expect
				.poll(async () => (await runtime.activity(session)).execution.phase, { timeout: 30000 })
				.toBe("retrying");
			const retry = await runtime.activity(session);
			expect(retry.state).toBe("running");
			expect(retry.execution.retryAt).toBeGreaterThan(Date.now() - 1000);
			expect(retry.execution.issue).toBeUndefined();
			expect(JSON.stringify(retry.execution)).not.toContain("private-error-marker");
			peerId = await create();
			holdPeer = true;
			const peer = runtime.submit(peerId, { text: "Hold at real prompt preparation." });
			await expect.poll(async () => (await runtime.activity(peerId!)).execution.phase).toBe("running");
			expect((await activity())[0]).toMatchObject({ state: "running", execution: { phase: "running" } });
			expect((await activity())[0]!.tasks.some((task) => task.execution.phase === "retrying")).toBe(true);
			releasePeer();
			await peer;
			expect((await pending).status).toBe("done");
			expect((await runtime.activity(session)).execution).toEqual({ phase: "idle" });

			// Fallback uses the same native retry checkpoint, not a terminal failure.
			profile.fallback = { models: ["openai/gpt-6.1-sol"] };
			config.retry.maxRetries = 0;
			mode = "fallback";
			calls = 0;
			const fallback = runtime.submit(session, { text: "Reply briefly recovered. Do not call tools." });
			await expect.poll(async () => (await runtime.activity(session)).execution.phase).toBe("retrying");
			expect((await runtime.activity(session)).execution.issue).toBeUndefined();
			expect((await fallback).status).toBe("done");
			expect(calls).toBeGreaterThanOrEqual(4);
			expect((await runtime.activity(session)).execution).toEqual({ phase: "idle" });

			delete profile.fallback;
			config.retry.maxRetries = 1;
			mode = "fail";
			const cancelled = runtime.submit(session, { text: "Check native cancellation during backoff." });
			await expect.poll(async () => (await runtime.activity(session)).execution.phase).toBe("retrying");
			await runtime.abort(session);
			expect((await cancelled).status).toBe("aborted");
			expect((await runtime.activity(session)).execution).toEqual({ phase: "idle" });

			config.retry.maxRetries = 0;
			const failed = await runtime.submit(session, { text: "Check terminal HTTP failure." });
			expect(failed.status).toBe("error");
			const issue = (await runtime.activity(session)).execution;
			expect(issue).toMatchObject({ phase: "blocked", issue: { code: "model_error", runId: failed.runId } });
			expect(JSON.stringify(issue)).not.toContain("private-error-marker");
			await runtime.close();
			runtime = await open();
			await runtime.recover();
			expect((await runtime.activity(session)).execution).toEqual(issue);
			await runtime.abort(session);
			await runtime.close();
			runtime = await open();
			await runtime.recover();
			expect((await runtime.activity(session)).execution).toEqual({ phase: "idle" });
		} finally {
			releasePeer();
			await runtime.close();
			server.closeAllConnections();
			await new Promise<void>((done) => server.close(() => done()));
			await rm(home, { recursive: true, force: true });
		}
	},
	180000,
);
