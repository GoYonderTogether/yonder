import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { resolveProfile } from "../config/index.js";
import { createStore } from "../store/index.js";
import { openDatabase } from "./db.js";
import { Runtime } from "./index.js";

const auth = process.env.YONDER_TEST_AUTH ?? resolve(".yonder/auth.json");
test.skipIf(process.env.YONDER_TEST_REAL !== "1" || !existsSync(auth))(
	"real queued runs take their configuration at start and survive the preceding run's limit",
	async () => {
		const home = await mkdtemp("/tmp/yonder-boundary-");
		const db = await openDatabase(`${home}/state.db`);
		const store = await createStore(db);
		const preparations: string[] = [];
		let profile = resolveProfile({ capabilities: ["exec"], tools: { offer: ["bash"] }, limits: { maxMinutes: 1 } });
		const runtime = await Runtime.open({
			home,
			db,
			config: { schema: 1, credentials: auth },
			readEvent: store.events.get,
			prepareInput: async (_id, event, config) => {
				preparations.push(config.resolved.model);
				return { text: String((event.data as { text: string }).text), event };
			},
			resolveSession: async () => ({ agent: null, profile: "check", cwd: home, resolved: profile }),
		});
		const queued = async () =>
			(await db.all<{ record: string }>("SELECT record FROM pi_submissions")).some(
				(row) => JSON.parse(row.record).status === "queued",
			);
		try {
			const session = await runtime.create({ agent: null, profile: "check", cwd: home });
			let started = false;
			const firstEvent = await store.events.record({
				type: "session.input",
				data: {
					session,
					text: "Call bash twice sequentially. First command: sleep 3; printf first-tool. Wait for its result, then call bash with command: printf second-tool. After both tools, reply first-complete.",
				},
			});
			const first = runtime.submit(session, {
				event: firstEvent,
				text: "Call bash twice sequentially. First command: sleep 3; printf first-tool. Wait for its result, then call bash with command: printf second-tool. After both tools, reply first-complete.",
				onOutput: (part) => {
					if (part.type === "tool" && part.phase === "start") started = true;
				},
			});
			await expect.poll(() => started, { timeout: 30000 }).toBe(true);
			const secondEvent = await store.events.record({
				type: "session.input",
				data: { session, text: "Reply exactly second-complete. Do not call tools." },
			});
			const second = runtime.submit(session, {
				event: secondEvent,
				text: String((secondEvent.data as { text: string }).text),
			});
			await expect.poll(queued, { timeout: 2000 }).toBe(true);
			profile = resolveProfile({
				model: "openai/gpt-6.1-sol",
				capabilities: ["read"],
				tools: { offer: ["read"] },
				limits: { maxMinutes: 1 },
			});
			const [a, b] = await Promise.all([first, second]);
			expect([a.status, b.status]).toEqual(["done", "done"]);
			expect(a.text).toContain("first-complete");
			expect(b.text).toContain("second-complete");
			expect(a.config?.resolved.model).toBe("openai/gpt-6-luna");
			expect(b.config?.resolved.model).toBe("openai/gpt-6.1-sol");
			expect(preparations.slice(0, 2)).toEqual(["openai/gpt-6-luna", "openai/gpt-6.1-sol"]);
			const transcript = await runtime.transcript(session);
			expect(transcript.flatMap((item) => item.tools ?? []).filter((tool) => tool.name === "bash")).toHaveLength(2);
			const models = (
				await db.all<{ record: string }>(
					"SELECT record FROM pi_entries WHERE conversation_id = ? ORDER BY id",
					Number(session),
				)
			)
				.flatMap((row) => JSON.parse(row.record).model ?? [])
				.filter((message) => message.role === "assistant")
				.map((message) => message.model);
			expect(models.slice(0, -1).every((model) => model === "gpt-6-luna")).toBe(true);
			expect(models.at(-1)).toBe("gpt-6.1-sol");
			profile = resolveProfile({
				capabilities: ["exec"],
				tools: { offer: ["bash"] },
				limits: { maxTurns: 1, maxMinutes: 1 },
			});
			const limited = await runtime.create({ agent: null, profile: "check", cwd: home });
			started = false;
			const stopping = runtime.submit(limited, {
				text: "Call bash once with command: sleep 3; printf limit-check. Then report the output.",
				onOutput: (part) => {
					if (part.type === "tool" && part.phase === "start") started = true;
				},
			});
			await expect.poll(() => started, { timeout: 30000 }).toBe(true);
			const following = runtime.submit(limited, { text: "Reply exactly queued-after-limit. Do not call tools." });
			await expect.poll(queued, { timeout: 2000 }).toBe(true);
			profile = resolveProfile({ limits: { maxTurns: 5, maxMinutes: 1 } });
			const [c, d] = await Promise.all([stopping, following]);
			expect([c.status, c.reason, d.status]).toEqual(["limit", "maxTurns", "done"]);
			expect(d.text).toContain("queued-after-limit");
		} finally {
			await runtime.close();
			await rm(home, { recursive: true, force: true });
		}
	},
	150000,
);

test("the run budget cancels context rendering before any model request", async () => {
	const home = await mkdtemp("/tmp/yonder-render-budget-");
	const runtime = await Runtime.open({
		home,
		db: await openDatabase(`${home}/state.db`),
		config: { schema: 1 },
		resolveSession: async () => ({
			agent: null,
			profile: "check",
			cwd: home,
			resolved: resolveProfile({ limits: { maxMinutes: 0.001 } }),
		}),
		sections: async (_session, signal) => {
			assert(signal);
			await once(signal, "abort");
			throw signal.reason;
		},
	});
	try {
		const session = await runtime.create({ agent: null, profile: "check", cwd: home });
		const run = await runtime.submit(session, { text: "N01 context cancellation verification" });
		expect([run.status, run.reason, run.usage.cost]).toEqual(["limit", "maxMinutes", 0]);
	} finally {
		await runtime.close();
		await rm(home, { recursive: true, force: true });
	}
});

test.skipIf(process.env.YONDER_TEST_REAL !== "1" || !existsSync(auth))(
	"new images share the request budget while incompatible old image history is retained",
	async () => {
		const home = await mkdtemp("/tmp/yonder-image-budget-");
		let runtime: Runtime | undefined;
		try {
			const { writeFile } = await import("node:fs/promises");
			const { pathToFileURL } = await import("node:url");
			const path = `${home}/pixel.png`;
			await writeFile(
				path,
				Buffer.from(
					"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
					"base64",
				),
			);
			const imageCount = async () => {
				const db = await openDatabase(`${home}/state.db`, true);
				try {
					const rows = await db.all<{ record: string }>("SELECT record FROM pi_entries");
					return rows
						.map((row) => JSON.parse(row.record))
						.flatMap((entry) => entry.edits ?? [])
						.flatMap((edit) => edit.messages ?? [])
						.flatMap((message) => message.content ?? [])
						.filter((block) => block.type === "image").length;
				} finally {
					await db.close();
				}
			};
			const open = async (supportsImages: boolean) =>
				Runtime.open({
					home,
					db: await openDatabase(`${home}/state.db`),
					config: {
						schema: 1,
						credentials: auth,
						models: {
							providers: {
								openai: {
									modelOverrides: {
										"gpt-6-luna": {
											input: supportsImages ? ["text", "image"] : ["text"],
											inputLimits: { images: { maxPerRequest: 1, maxPerMessage: 1 } },
										},
									},
								},
							},
						},
					},
					resolveSession: async () => ({
						agent: null,
						profile: "images",
						cwd: home,
						resolved: resolveProfile({ limits: { maxMinutes: 1 } }),
					}),
				});
			runtime = await open(true);
			const id = await runtime.create({ agent: null, profile: "images", cwd: home });
			const image = { kind: "image" as const, mime: "image/png", uri: pathToFileURL(path).href };
			await runtime.submit(id, { text: "An explicitly supplied image.", attachments: [image], wake: "write" });
			const run = await runtime.submit(id, {
				text: "Reply exactly image-budget-check. Do not call tools.",
				attachments: [image],
			});
			expect(run.status, run.reason).toBe("done");
			const messages = await runtime.transcript(id);
			expect(messages.filter((item) => item.kind === "yonder.prepared")).toHaveLength(2);
			await runtime.close();
			expect(await imageCount()).toBe(1);
			runtime = await open(false);
			const rejected = await runtime.submit(id, { text: "This cannot remove the previous image history." });
			expect(rejected.status).toBe("error");
			expect(rejected.reason).toContain("cannot accept images");
			expect(rejected.usage.cost).toBe(0);
			expect(await imageCount()).toBe(1);
			expect(
				(await runtime.transcript(id)).filter((item) => item.kind === "yonder.prepared").length,
			).toBeGreaterThanOrEqual(2);
		} finally {
			await runtime?.close();
			await rm(home, { recursive: true, force: true });
		}
	},
	90000,
);

test("the native run deadline cancels input preparation before a model request", async () => {
	const home = await mkdtemp("/tmp/yonder-input-deadline-");
	const db = await openDatabase(`${home}/state.db`);
	const store = await createStore(db);
	const runtime = await Runtime.open({
		home,
		db,
		config: { schema: 1 },
		readEvent: store.events.get,
		resolveSession: async () => ({
			agent: null,
			profile: "deadline",
			cwd: home,
			resolved: resolveProfile({ limits: { maxMinutes: 0.001 } }),
		}),
		prepareInput: async (_id, _event, _config, _wake, signal) => {
			assert(signal);
			await once(signal, "abort");
			throw signal.reason;
		},
	});
	try {
		const session = await runtime.create({ agent: null, profile: "deadline", cwd: home });
		const event = await store.events.record({
			type: "session.input",
			data: { session, text: "Input cancellation check" },
		});
		const run = await runtime.submit(session, { text: "Input cancellation check", event });
		expect([run.status, run.reason, run.usage.cost]).toEqual(["limit", "maxMinutes", 0]);
	} finally {
		await runtime.close();
		await rm(home, { recursive: true, force: true });
	}
});
