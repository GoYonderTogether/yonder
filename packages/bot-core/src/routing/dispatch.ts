import type { AgentConfig } from "@yonder/bot-definition";
import type { Runtime, RuntimeInput, RuntimeRun } from "@yonder/runtime-adapter/types";
import type { OutputPart, RunResult, SessionInfo, YEvent } from "@yonder/sdk";
import type { Store } from "../store/contracts.js";
import type { RoutedRun } from "./types.js";

export interface DispatchDeps {
	store: Store;
	agents: Map<string, AgentConfig>;
	runtime: () => Runtime;
	report: (error: unknown) => void;
	finish: (agent: string, event: string, result: RunResult) => void;
	notify: (session: string, event: YEvent) => Promise<void> | undefined;
	onOwnerMention?: (session: SessionInfo, event: YEvent) => Promise<void>;
	onCommand?: (session: SessionInfo, event: YEvent) => Promise<RunResult | undefined>;
	onStart?: (
		session: SessionInfo,
		event: YEvent,
		waiter: boolean,
	) => ((part: OutputPart, runId?: string) => void) | undefined;
	onRun?: (session: SessionInfo, run: RuntimeRun, inputs: YEvent[], waiter: boolean) => void | Promise<void>;
}

/** 已路由输入的实际提交：写绑定只落账本，运行绑定走原生 submit。 */
export async function dispatchRun(routed: RoutedRun, event: YEvent, deps: DispatchDeps): Promise<void> {
	try {
		const session = await deps.store.sessions.get(routed.session);
		if (!session) throw new Error(`Missing routed session: ${routed.session}`);
		const data = event.data as { kind?: unknown; social?: { mentions?: { owner?: boolean } } };
		const ownerMention =
			event.type === "message.in" &&
			(data.kind === "group" || data.kind === "channel") &&
			deps.agents.get(routed.agent)?.social?.enabled === true &&
			data.social?.mentions?.owner === true;
		if (ownerMention) await deps.onOwnerMention?.(session, event).catch(deps.report);
		const notification = deps.notify(session.id, event);
		if (notification) await notification;
		if (routed.wake === "run") {
			const command = await deps.onCommand?.(session, event);
			if (command) {
				deps.finish(routed.agent, event.id, command);
				return;
			}
		}
		const inputData = event.data as { text?: string; attachments?: RuntimeInput["attachments"] };
		const waiter = event.routes?.find((route) => route.session === session.id)?.waiting ?? false;
		const startedOutput = routed.wake === "run" ? deps.onStart?.(session, event, waiter) : undefined;
		const output = (part: OutputPart, runId?: string) => {
			try {
				startedOutput?.(part, runId);
			} catch (error) {
				deps.report(error);
			}
		};
		const attachments = inputData.attachments;
		const input: RuntimeInput = {
			text: inputData.text ?? "",
			event,
			wake: routed.wake,
			busy: event.routes?.find((route) => route.session === session.id)?.busy ?? "steer",
			...(attachments ? { attachments } : {}),
			requestId:
				event.type === "runtime.tool-result"
					? `background:${(event.data as { job: string }).job}`
					: event.type === "runtime.continuation"
						? `continuation:${(event.data as { job: string }).job}`
						: `event:${event.id}`,
			...(startedOutput ? { onOutput: output } : {}),
		};
		await deps.runtime().submit(session.id, input);
	} catch (error) {
		await failRun(routed, event, error, deps);
	}
}

/** 提交失败如实记录错误结果；写绑定不产生运行结果。 */
async function failRun(routed: RoutedRun, event: YEvent, error: unknown, deps: DispatchDeps): Promise<void> {
	deps.report(error);
	if (routed.wake === "write") return;
	const run: RuntimeRun = {
		runId: `error:${event.id}`,
		status: "error",
		text: "",
		reason: error instanceof Error ? error.message : String(error),
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
		inputs: [event.id],
	};
	const session = await deps.store.sessions.get(routed.session);
	if (session) {
		if (!(await deps.runtime().admitted(session.id, event.id)))
			await deps.onRun?.(
				session,
				run,
				[event],
				event.routes?.find((route) => route.session === session.id)?.waiting ?? false,
			);
		deps.finish(session.agent ?? "", event.id, {
			agent: session.agent,
			session: session.id,
			status: run.status,
			text: run.text,
			...(run.reason ? { reason: run.reason } : {}),
		});
		return;
	}
	deps.finish(routed.agent, event.id, {
		agent: routed.agent,
		session: routed.session,
		status: "error",
		text: "",
		...(run.reason ? { reason: run.reason } : {}),
	});
}
