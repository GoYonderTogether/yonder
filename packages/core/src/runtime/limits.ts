import { once } from "node:events";
import { isDeepStrictEqual } from "node:util";
import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT as C } from "@earendil-works/chord/context";
import {
	GenerationTask,
	type Harness,
	type HookApi,
	hook,
	type JsonObject,
	LiveDoc,
	ToolTask,
} from "@earendil-works/pi-durable";
import type { Models } from "@yonder/sdk";
import { cid, RunDoc, type RunState } from "./docs.js";
import type { RuntimeOptions, RuntimeRun, RuntimeSessionConfig } from "./types.js";

export interface LimitsDeps {
	harness(): Harness;
	models: Models;
	onReport: ((error: unknown) => void) | undefined;
	onWarning: RuntimeOptions["onWarning"] | undefined;
	usage(session: string): Promise<RuntimeRun["usage"]>;
	denied(
		name: string,
		args: JsonObject,
		config: RuntimeSessionConfig,
		context: Context,
		session: string,
	): Promise<string | undefined>;
}

/** Soft run thresholds, repeat protection and model-input limits for active runs. */
export class RunLimits {
	readonly states = new Map<string, RunState>();
	constructor(private deps: LimitsDeps) {}
	arm(state: RunState): void {
		state.timer = setTimeout(
			() => {
				void this.warn(
					state,
					"maxMinutes",
					`Task has run for ${state.config.resolved.limits.maxMinutes} minutes; continue as needed and report meaningful progress.`,
				).catch(this.deps.onReport ?? (() => {}));
			},
			Math.max(0, state.deadline - Date.now()),
		);
		state.timer.unref();
	}
	private async warn(state: RunState, kind: string, text: string): Promise<void> {
		if (state.warnings.has(kind)) return;
		state.warnings.add(kind);
		await this.saveRun(state);
		await this.deps.onWarning?.(state.session, { kind, text });
	}
	private async saveRun(state: RunState): Promise<void> {
		await this.deps.harness().commit(async (tx) => {
			Object.assign(await tx.doc(RunDoc, cid(state.session), state.id, null), {
				turns: state.turns,
				toolTasks: state.toolTasks,
				warnings: [...state.warnings],
				previous: state.previous ? JSON.stringify(state.previous) : "",
				repeats: state.repeats,
				reason: state.reason ?? null,
				error: state.error ?? null,
			});
		}, C);
	}
	private async abortRun(state: RunState, reason: string): Promise<void> {
		const live = await this.deps.harness().snapshot(LiveDoc, cid(state.session), C);
		if (String(live?.run?.inputs[0]) !== state.id) return;
		if (!state.error) state.reason ??= reason;
		await this.saveRun(state);
		if (live?.run) await this.deps.harness().abortTask(live.run.taskId, C);
	}
	private async runState(api: HookApi, context: Context): Promise<RunState> {
		const live = await api.snapshot(LiveDoc, api.conversationId, context);
		const id = String(live?.run?.inputs[0] ?? api.taskId);
		const state = this.states.get(id);
		if (!state) throw new Error(`Missing active run ${id}`);

		return state;
	}
	private async stop(context: Context, state: RunState, reason: string, error = false): Promise<never> {
		if (error) state.error = reason;
		const signal = context.abortSignal!;
		signal.throwIfAborted();
		const stopped = once(signal, "abort");
		// Abort must run outside this hook: abort() joins the invocation being stopped.
		void this.abortRun(state, reason).catch(this.deps.onReport ?? (() => {}));
		await stopped;
		throw signal.reason;
	}

	/** Hooks installed on the yonder.core extension. */
	hooks() {
		return [
			hook(GenerationTask, {
				beforeRequest: async (request, api, context) => {
					const state = await this.runState(api, context);
					if (state.reason) await this.stop(context, state, state.reason);
					if (state.turns >= state.config.resolved.limits.maxTurns)
						await this.warn(state, "maxTurns", `Task has used ${state.turns} model turns; continue if work remains.`);
					const model = this.deps.models.getModel(
						state.config.resolved.model.split("/")[0]!,
						state.config.resolved.model.slice(state.config.resolved.model.indexOf("/") + 1),
					);
					const limits = model?.inputLimits,
						images = request.messages.flatMap((message) =>
							Array.isArray(message.content) ? message.content.filter((block) => block.type === "image") : [],
						);
					if (images.length && !model?.input.includes("image"))
						await this.stop(context, state, "Current model cannot accept images already in conversation history", true);
					if (
						images.length > (limits?.images?.maxPerRequest ?? Infinity) ||
						request.messages.some(
							(message) =>
								Array.isArray(message.content) &&
								message.content.filter((block) => block.type === "image").length >
									(limits?.images?.maxPerMessage ?? Infinity),
						)
					)
						await this.stop(
							context,
							state,
							"Conversation image count exceeds the current model's input limit; history was retained",
							true,
						);
					if (Buffer.byteLength(JSON.stringify(request.messages)) > (limits?.maxRequestBytes ?? Infinity))
						await this.stop(
							context,
							state,
							"Conversation input exceeds the current model's request byte limit; history was retained",
							true,
						);

					state.turns++;
					await this.saveRun(state);
				},
				afterResponse: async (message, api, context) => {
					const state = await this.runState(api, context);
					const usage = await this.deps.usage(state.session);
					const tokens = (["input", "output", "cacheRead", "cacheWrite"] as const).reduce(
						(sum, key) => sum + usage[key] + message.usage[key] - state.usageBefore[key],
						0,
					);
					if (state.turns >= state.config.resolved.limits.maxTurns)
						await this.warn(state, "maxTurns", `Task has used ${state.turns} model turns; continue if work remains.`);
					if (tokens >= state.config.resolved.limits.maxTokens)
						await this.warn(
							state,
							"maxTokens",
							`Task has used ${tokens} input/output/cache tokens. Preserve the goal and continue necessary work.`,
						);
				},
			}),
			hook(ToolTask, {
				beforeTool: async (call, api, context) => {
					const state = await this.runState(api, context);
					if (!state.toolTasks.includes(api.taskId)) state.toolTasks.push(api.taskId);
					const callKey = { name: call.name, args: call.arguments };
					const observing =
						call.name === "process" && ["status", "log", "wait"].includes(String(call.arguments.action));
					state.repeats = observing ? 0 : isDeepStrictEqual(callKey, state.previous) ? state.repeats + 1 : 1;
					state.previous = structuredClone(callKey);
					await this.saveRun(state);
					if (state.repeats >= state.config.resolved.limits.repeatStop) await this.stop(context, state, "repeatStop");
					if (state.repeats >= state.config.resolved.limits.repeatBlock)
						return { block: "相同工具调用已重复，请换一种方法。" };
					const config = state.config;
					const denied = await this.deps.denied(
						call.name,
						call.arguments as JsonObject,
						config,
						context,
						String(api.conversationId),
					);
					if (denied) return { block: denied };
				},
			}),
		];
	}
}
