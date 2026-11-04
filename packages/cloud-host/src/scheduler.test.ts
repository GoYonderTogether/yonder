import { newEvent } from "@yonder/bot-core/store/event";
import type { TriggerIO } from "@yonder/sdk";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { createPostgresScheduler, migrateScheduler } from "./scheduler.js";
import { testPostgres, testPostgresUnavailable } from "./test-postgres.js";

let database: Awaited<ReturnType<typeof testPostgres>>;
beforeAll(async () => {
	if (testPostgresUnavailable) return;
	database = await testPostgres();
	await migrateScheduler(database.pool);
}, 60000);
afterAll(async () => {
	await database?.close();
});

test.skipIf(testPostgresUnavailable)(
	"concurrent persisted Bot deadlines keep one real timer and detach preserves inactive wakeups",
	async () => {
		const nativeSet = globalThis.setTimeout;
		const nativeClear = globalThis.clearTimeout;
		const timers = new Set<ReturnType<typeof setTimeout>>();
		let maximum = 0;
		const set = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
			callback: (...args: unknown[]) => void,
			delay?: number,
			...args: unknown[]
		) => {
			const schedulerCall = callback.name === "wakeDeadlines";
			const timer = nativeSet(() => {
				timers.delete(timer);
				callback(...args);
			}, delay);
			if (schedulerCall) {
				timers.add(timer);
				maximum = Math.max(maximum, timers.size);
			}
			return timer;
		}) as typeof setTimeout);
		const clear = vi.spyOn(globalThis, "clearTimeout").mockImplementation((timer) => {
			timers.delete(timer as ReturnType<typeof setTimeout>);
			nativeClear(timer);
		});
		const counts = new Map<string, number>();
		const bindings = new Map<string, ReturnType<ReturnType<typeof createPostgresScheduler>["scope"]>>();
		const errors: unknown[] = [];
		const startedAt = Date.now();
		const scheduler = createPostgresScheduler(
			database.pool,
			async (tenant, bot, key, now) => {
				const scope = scheduler.scope(tenant, bot);
				let io!: TriggerIO;
				await scope.start(
					key,
					{
						id: key,
						async start(value) {
							io = value;
							expect(io.startedAt).toBe(startedAt);
						},
						async tick() {
							counts.set(bot, (counts.get(bot) ?? 0) + 1);
							await io.schedule(undefined);
						},
						async stop() {
							await io.schedule(undefined);
						},
					},
					async (input) => newEvent(input),
				);
				bindings.set(bot, scope);
				await scope.run(key, now);
			},
			(error) => errors.push(error),
			startedAt,
		);
		try {
			await Promise.all(
				Array.from({ length: 20 }, async (_, index) => {
					const bot = `bot-${index}`;
					const scope = scheduler.scope("tenant", bot);
					let io!: TriggerIO;
					const stop = await scope.start(
						"job",
						{
							id: "job",
							async start(value) {
								io = value;
								await io.schedule(Date.now() + 1000);
							},
							async stop() {
								await io.schedule(undefined);
							},
						},
						async (input) => newEvent(input),
					);
					await scope.stop();
					await stop();
				}),
			);
			expect((await database.pool.query("SELECT count(*)::int AS n FROM bot_deadlines")).rows[0].n).toBe(20);
			await vi.waitFor(() => expect(counts.size).toBe(20), { timeout: 5000 });
			expect([...counts.values()]).toEqual(Array(20).fill(1));
			expect(maximum).toBe(1);
			expect(errors).toEqual([]);
		} finally {
			await scheduler.stop();
			for (const scope of bindings.values()) await scope.stop();
			set.mockRestore();
			clear.mockRestore();
		}
	},
);

test.skipIf(testPostgresUnavailable)(
	"an older arm query cannot install a second timer after a newer arm has finished",
	async () => {
		const nativeQuery = database.pool.query.bind(database.pool);
		let release!: () => void;
		let entered!: () => void;
		const waiting = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const delayed = new Promise<void>((resolve) => {
			release = resolve;
		});
		let first = true;
		const query = vi.spyOn(database.pool, "query").mockImplementation((async (
			...args: Parameters<typeof nativeQuery>
		) => {
			const result = await Reflect.apply(nativeQuery, database.pool, args);
			if (first) {
				first = false;
				entered();
				await delayed;
			}
			return result;
		}) as typeof database.pool.query);
		const nativeSet = globalThis.setTimeout;
		let armed = 0;
		const timer = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
			callback: (...args: unknown[]) => void,
			delay?: number,
			...args: unknown[]
		) => {
			if (callback.name === "wakeDeadlines") armed++;
			return nativeSet(callback, delay, ...args);
		}) as typeof setTimeout);
		const scheduler = createPostgresScheduler(
			database.pool,
			async () => {},
			(error) => {
				throw error;
			},
			Date.now(),
			{ maintenance: async () => {} },
		);
		try {
			const older = scheduler.start();
			await waiting;
			await scheduler.start();
			release();
			await older;
			expect(armed).toBe(1);
		} finally {
			release();
			await scheduler.stop();
			query.mockRestore();
			timer.mockRestore();
		}
	},
);
