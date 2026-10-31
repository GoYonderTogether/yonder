import type { RunResult, SessionInfo } from "@yonder/sdk";
import type { createDelivery } from "../delivery/index.js";
import type { createRouter } from "../routing/index.js";
import type { Runtime, RuntimeRun } from "../runtime/index.js";
import { closeOnRunEnd } from "../sessions/close-policy.js";
import type { createSessions } from "../sessions/index.js";
import type { Store } from "../store/index.js";
import type { quotaWire } from "./quota-wire.js";

/**
 * Run completion wiring: quota settle, durable run.end, channel delivery, router finish, then the close decision.
 * The services it calls are created later in openKernel, so every one is a getter invoked at run time.
 */
export function createRunCompletion({
	store,
	runtime,
	delivery,
	gate,
	router,
	sessions,
}: {
	store: Store;
	runtime: () => Runtime;
	delivery: () => ReturnType<typeof createDelivery>;
	gate: () => ReturnType<typeof quotaWire>;
	router: () => ReturnType<typeof createRouter>;
	sessions: () => ReturnType<typeof createSessions>;
}) {
	/** 运行结束后的关闭原因：task 会话读一次运行期策略，失败的运行不关闭（见 sessions 的 closeOnRunEnd）。 */
	const closeReason = async (id: string, mode: SessionInfo["mode"], status: string) => {
		const close = mode === "task" ? (await runtime().sessionState(id))?.close : undefined;
		return closeOnRunEnd(mode, status as RunResult["status"], close);
	};
	const completeRun = async (id: string, run: RuntimeRun) => {
		const session = await store.sessions.get(id);
		if (!session) throw new Error(`Missing runtime session: ${id}`);
		const completion = await delivery().onRun(session, run, []);
		await gate().settle(id, run);
		await store.events.recordRun(completion.ending);
		completion.deliver();
		await router().finishRun(session, run);
		if (!(await runtime().hasPendingWork(id))) {
			const close = await closeReason(id, session.mode, run.status);
			if (close) await sessions().closeSession(id, close);
		}
	};
	return { closeReason, completeRun };
}
