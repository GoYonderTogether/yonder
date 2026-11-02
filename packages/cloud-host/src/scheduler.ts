import type { EventInput, Trigger, YEvent } from "@yonder/sdk";
import type { Pool } from "pg";

export const schedulerSchema = `CREATE TABLE IF NOT EXISTS bot_deadlines (
 tenant_id TEXT NOT NULL, bot_id TEXT NOT NULL, trigger_key TEXT NOT NULL,
 due_at BIGINT NOT NULL, PRIMARY KEY(tenant_id,bot_id,trigger_key)
)`;
export async function migrateScheduler(pool: Pool) {
	await pool.query(schedulerSchema);
}

/** One worker timer also wakes inactive Bots. Detaching an instance preserves its deadline. */
export function createPostgresScheduler(
	pool: Pool,
	wake: (tenant: string, bot: string, trigger: string, now: number) => Promise<void>,
	report: (error: unknown) => void,
	startedAt = Date.now(),
	options: {
		enabled?(tenant: string, bot: string): boolean;
		maintenance?(now: number): Promise<void>;
		changed?(): void;
	} = {},
) {
	type Binding = { trigger: Trigger; attached: boolean; pending?: Promise<void> };
	const entries = new Map<string, Binding>();
	const keyOf = (tenant: string, bot: string, key: string) => JSON.stringify([tenant, bot, key]);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let stopped = false;
	let generation = 0;
	let pending: Promise<void> | undefined;
	let nextMaintenance = startedAt + 15000;
	async function arm() {
		const revision = ++generation;
		clearTimeout(timer);
		timer = undefined;
		if (stopped || pending) return;
		const { rows } = await pool.query<{ tenant_id: string; bot_id: string; due_at: string }>(
			"SELECT tenant_id,bot_id,due_at FROM bot_deadlines ORDER BY due_at",
		);
		const due = rows.find((row) => options.enabled?.(row.tenant_id, row.bot_id) !== false);
		const at = Math.min(due ? Number(due.due_at) : Infinity, options.maintenance ? nextMaintenance : Infinity);
		if (revision !== generation || !Number.isFinite(at) || stopped || pending) return;
		timer = setTimeout(
			function wakeDeadlines() {
				pending = dispatch()
					.catch(report)
					.finally(async () => {
						pending = undefined;
						await arm();
					});
			},
			Math.max(1, Math.min(2147483647, at - Date.now())),
		);
		timer.unref();
	}
	async function dispatch() {
		const now = Date.now();
		if (options.maintenance && now >= nextMaintenance) {
			nextMaintenance = now + 15000;
			await options.maintenance(now);
		}
		const { rows } = await pool.query<{ tenant_id: string; bot_id: string; trigger_key: string }>(
			"SELECT tenant_id,bot_id,trigger_key FROM bot_deadlines WHERE due_at <= $1 ORDER BY due_at",
			[now],
		);
		await Promise.all(
			rows
				.filter((row) => options.enabled?.(row.tenant_id, row.bot_id) !== false)
				.map(async (row) => {
					try {
						await wake(row.tenant_id, row.bot_id, row.trigger_key, now);
					} catch (error) {
						report(error);
					}
				}),
		);
	}
	return {
		startedAt,
		async start() {
			await arm();
		},
		scope(tenant: string, bot: string) {
			const bindings = new Set<string>();
			return {
				busy: () =>
					[...bindings].some((id) => {
						const entry = entries.get(id);
						return !!entry?.pending || entry?.trigger.busy?.() === true;
					}),
				async start(key: string, trigger: Trigger, emit: (event: EventInput) => Promise<YEvent>) {
					const id = keyOf(tenant, bot, key);
					const entry: Binding = { trigger, attached: true };
					entries.set(id, entry);
					bindings.add(id);
					await trigger.start({
						emit,
						startedAt,
						async schedule(at) {
							if (!entry.attached || stopped) return;
							if (at === undefined)
								await pool.query("DELETE FROM bot_deadlines WHERE tenant_id=$1 AND bot_id=$2 AND trigger_key=$3", [
									tenant,
									bot,
									key,
								]);
							else
								await pool.query(
									"INSERT INTO bot_deadlines(tenant_id,bot_id,trigger_key,due_at) VALUES($1,$2,$3,$4) ON CONFLICT(tenant_id,bot_id,trigger_key) DO UPDATE SET due_at=EXCLUDED.due_at",
									[tenant, bot, key, at],
								);
							await arm();
							if (options.changed) setImmediate(options.changed);
						},
					});
					return async () => {
						entry.attached = false;
						entries.delete(id);
						bindings.delete(id);
						await trigger.stop();
						await entry.pending;
					};
				},
				async run(key: string, now: number) {
					const entry = entries.get(keyOf(tenant, bot, key));
					if (!entry || entry.pending) return;
					entry.pending = Promise.resolve()
						.then(() => entry.trigger.tick?.(now))
						.finally(() => {
							delete entry.pending;
						});
					await entry.pending;
				},
				async stop() {
					for (const id of bindings) {
						const entry = entries.get(id);
						if (entry) entry.attached = false;
						entries.delete(id);
					}
					bindings.clear();
				},
			};
		},
		async stop() {
			stopped = true;
			clearTimeout(timer);
			await pending;
		},
	};
}
