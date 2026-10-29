import type { ToolResult } from "@yonder/sdk";
import { type createDelivery, sourceMessage } from "../delivery/index.js";
import type { Runtime } from "../runtime/index.js";
import type { RuntimeOptions } from "../runtime/types.js";
import type { createStore } from "../store/index.js";
import type { createViews } from "../views/index.js";

const escapeXml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const truncate = (value: string, max: number) =>
	value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;

/** bash reports its exit code inside its JSON result body; other tools report none. */
const exitCodeOf = (text: string): number | undefined => {
	try {
		const value = JSON.parse(text) as { exitCode?: unknown };
		return typeof value.exitCode === "number" ? value.exitCode : undefined;
	} catch {
		return undefined;
	}
};

/**
 * Durable completion notice for a finished background job. A job with a log file carries terminal state and metadata
 * only; its output is read on demand with bg_logs, so the notice stays cheap however much the job printed.
 */
export const completionNotice = (input: { id: string; name: string; result: ToolResult; outputFile?: string }) => {
	const name = input.name.trim() || input.id;
	const status = input.result.isError ? "failed" : "completed";
	const exitCode = exitCodeOf(input.result.text);
	// bash failures are described by their exit code; the JSON body is not an error message.
	const error =
		input.result.isError && input.outputFile && exitCode === undefined
			? truncate(input.result.text.trim(), 200)
			: undefined;
	return [
		"<background-task-notification>",
		`  <task-id>${escapeXml(input.id)}</task-id>`,
		`  <task-name>${escapeXml(name)}</task-name>`,
		`  <status>${status}</status>`,
		exitCode !== undefined ? `  <exit-code>${String(exitCode)}</exit-code>` : undefined,
		error ? `  <error>${escapeXml(error)}</error>` : undefined,
		input.outputFile ? `  <output-file>${escapeXml(input.outputFile)}</output-file>` : undefined,
		// Without a log file (task_run, agent_ask, SDK tools) the result is the only record the model can act on (spec 14).
		input.outputFile ? undefined : `  <result>${escapeXml(input.result.text.slice(-12000))}</result>`,
		`  <summary>${escapeXml(`Background task ${JSON.stringify(name)} ${status}`)}</summary>`,
		`  <guidance>${escapeXml("Terminal state and output metadata are durable. Do not call bg_status to reconfirm; use bg_logs only if output is needed.")}</guidance>`,
		"</background-task-notification>",
	]
		.filter(Boolean)
		.join("\n");
};

/** Runtime callbacks that turn background tool results and run warnings into recorded events and session notes. */
export function backgroundHandlers(ctx: {
	store: Awaited<ReturnType<typeof createStore>>;
	runtime: () => Runtime;
	delivery: ReturnType<typeof createDelivery>;
	report: (error: unknown) => void;
	views: ReturnType<typeof createViews>;
}): Pick<RuntimeOptions, "onBackground" | "onWarning" | "onBackgroundChanged"> {
	const { store, runtime: realRuntime, delivery } = ctx;
	return {
		onBackgroundChanged: () => ctx.views.invalidate("core", ["core.background.rail", "core.background.floating"]),
		onBackground: async (id, input) => {
			const row = await store.sessions.get(id);
			const origin = input.origin;
			const msgId = origin ? sourceMessage(origin) : undefined;
			const text = completionNotice(input);
			const event = await store.events.record(
				{
					type: "runtime.tool-result",
					...(origin ? { parent: origin.id } : {}),
					...(origin?.conv ? { conv: origin.conv } : {}),
					data: {
						session: id,
						job: input.id,
						...(msgId ? { msgId } : {}),
						tool: input.name,
						text,
						waiting: false,
						status: input.result.isError ? "error" : "done",
					},
				},
				origin?.routes?.filter((route) => route.session === id) ?? [],
			);
			if (!row || row.closed) return;
			const onOutput = delivery.onStart(row, event, false);
			await realRuntime().enqueue(id, {
				text,
				event,
				wake: "run",
				busy: "steer",
				requestId: `background:${input.id}`,
				...(onOutput ? { onOutput } : {}),
				attachments: input.result.attachments ?? [],
			});
		},
		onWarning: async (id, input) => {
			const row = await store.sessions.get(id);
			const event = await store.events.record({
				type: "runtime.warning",
				data: { session: id, kind: input.kind, text: input.text },
			});
			for (const target of [id, ...(row?.parent ? [row.parent] : [])]) {
				const parent = await store.sessions.get(target);
				if (!parent || parent.closed) continue;
				const text = target === id ? input.text : `Subtask session ${id}: ${input.text}`;
				await realRuntime().notify(target, { event: event.id, from: "system:yonder", text });
				await realRuntime().writeNote(target, `warning:${event.id}:${target}`, text);
			}
		},
	};
}
