import type { RunResult } from "@yonder/sdk";

export function createPendingResults() {
	const pending = new Map<string, Set<(result: RunResult) => void>>();
	const resultKey = (agent: string, event: string) => `${agent}\0${event}`;
	const waitFor = (agent: string, event: string) => {
		const key = resultKey(agent, event);
		let resolve!: (result: RunResult) => void;
		const promise = new Promise<RunResult>((done) => {
			resolve = done;
		});
		const group = pending.get(key) ?? new Set();
		group.add(resolve);
		pending.set(key, group);
		return promise;
	};
	const finish = (agent: string, event: string, result: RunResult) => {
		const key = resultKey(agent, event),
			group = pending.get(key);
		if (!group) return;
		pending.delete(key);
		for (const resolve of group) resolve(result);
	};

	return { waitFor, finish };
}

export function createReporter(onReport: (error: unknown) => void) {
	return (error: unknown) => {
		try {
			onReport(error);
		} catch {
			/* Reporting cannot interrupt event delivery. */
		}
	};
}
