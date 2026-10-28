export function reviewLifecycle({ grants, live, arm, cleanup, clearTimer, timeout, writesDone, stopNow }) {
	async function close(id) {
		const g = grants.get(id);
		if (g) {
			revoke(g);
			const s = live.get(g.parent);
			if (s?.running === g) s.running = null;
			return;
		}
		const s = live.get(id);
		if (!s) return;
		s.busy = false;
		arm(id);
	}
	async function stop() {
		stopNow();
		const cancellations = [];
		for (const s of live.values()) {
			s.generation++;
			s.pending = null;
			clearTimer(s);
			if (s.running) cancellations.push(cleanup(s.running));
			s.running = null;
		}
		await timeout(Promise.allSettled(cancellations), 2000);
		await writesDone();
	}
	return { close, stop };
}
