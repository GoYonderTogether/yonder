import type { EventInput, Trigger, YEvent } from "./types.js";

/** One host timer owns all deterministic plugin deadlines. */
export function createTriggerScheduler(report: (key: string, error: unknown) => void, startedAt = Date.now()) {
	const entries = new Map<string, { trigger: Trigger; at?: number; pending?: Promise<void> }>();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let stopped = false;
	function arm() {
		clearTimeout(timer);
		timer = undefined;
		if (stopped) return;
		const due = [...entries.values()]
			.filter((entry) => entry.at !== undefined && !entry.pending)
			.map((entry) => entry.at!);
		if (!due.length) return;
		timer = setTimeout(
			() => {
				timer = undefined;
				void tick();
			},
			Math.max(1, Math.min(2147483647, Math.min(...due) - Date.now())),
		);
		timer.unref();
	}
	async function tick() {
		const now = Date.now();
		for (const [key, entry] of entries) {
			if (entry.at === undefined || entry.at > now || entry.pending) continue;
			delete entry.at;
			entry.pending = Promise.resolve()
				.then(() => entry.trigger.tick?.(now))
				.catch((error) => report(key, error))
				.finally(() => {
					delete entry.pending;
					arm();
				});
		}
		arm();
	}
	return {
		async start(key: string, trigger: Trigger, emit: (event: EventInput) => Promise<YEvent>) {
			const entry: { trigger: Trigger; at?: number; pending?: Promise<void> } = { trigger };
			entries.set(key, entry);
			try {
				await trigger.start({
					emit,
					startedAt,
					schedule(at) {
						if (stopped || entries.get(key) !== entry) return;
						if (at === undefined) delete entry.at;
						else entry.at = at;
						arm();
					},
				});
			} catch (error) {
				entries.delete(key);
				arm();
				throw error;
			}
			return async () => {
				entries.delete(key);
				arm();
				await trigger.stop();
				await entry.pending;
			};
		},
		async stop() {
			stopped = true;
			clearTimeout(timer);
			timer = undefined;
			await Promise.all([...entries.values()].map((entry) => entry.pending));
		},
	};
}
