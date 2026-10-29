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
	onTick?(state: RunState): Promise<number | undefined>;
	tickIntervalMs?: number | undefined;
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
	arm(state: RunState, next = this.deps.tickIntervalMs ?? 300000): void {
		state.timer = setTimeout(
			() => {
				state.timer = undefined;
				void (async () => {
					if (Date.now() >= state.deadline)
						await this.warn(
							state,
							"maxMinutes",
							this.limitText("maxMinutes", state, `已运行 ${state.config.resolved.limits.maxMinutes} 分钟`),
						);
					const delay = await this.deps.onTick?.(state);
					if (
						!state.visibility.signal.aborted &&
						this.states.get(state.id) === state &&
						(delay !== undefined || !state.warnings.has("maxMinutes"))
					)
						this.arm(state, delay ?? Infinity);
				})().catch(this.deps.onReport ?? (() => {}));
			},
			Math.max(1, Math.min(next, state.warnings.has("maxMinutes") ? Infinity : state.deadline - Date.now())),
		);
		state.timer.unref();
	}
	/** 上限只提醒、不中止（architecture 第 5 节第 7 条）：这句同时进主人可见的会话备注和模型上下文。 */
	private limitText(kind: "maxTurns" | "maxTokens" | "maxMinutes", state: RunState, used: string): string {
		const limits = state.config.resolved.limits;
		const limit = kind === "maxTurns" ? limits.maxTurns : kind === "maxTokens" ? limits.maxTokens : limits.maxMinutes;
		return `这次回复因为达到 ${kind} 上限（${used}，上限 ${limit}）被截断，回复「继续」可以接着做。目标已完成就直接交付；没完成就继续做，并在交付时说明还剩什么。`;
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
						await this.warn(state, "maxTurns", this.limitText("maxTurns", state, `已用 ${state.turns} 轮`));
					const conversation = await this.deps.harness().conversation(api.conversationId, context);
					const ref = (await conversation!.agent(context)).model;
					const model = ref ? api.models.getModel(ref.provider, ref.modelId) : undefined;
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
					const tokens = (["input", "output"] as const).reduce(
						(sum, key) => sum + usage[key] + message.usage[key] - state.usageBefore[key],
						0,
					);
					if (state.turns >= state.config.resolved.limits.maxTurns)
						await this.warn(state, "maxTurns", this.limitText("maxTurns", state, `已用 ${state.turns} 轮`));
					if (tokens >= state.config.resolved.limits.maxTokens)
						await this.warn(
							state,
							"maxTokens",
							this.limitText("maxTokens", state, `本次已用 ${Math.round(tokens)} 个新输入与输出 tokens`),
						);
				},
			}),
			hook(ToolTask, {
				beforeTool: async (call, api, context) => {
					const state = await this.runState(api, context);
					if (!state.toolTasks.includes(api.taskId)) {
						state.toolTasks.push(api.taskId);
						state.lastToolAt = Date.now();
					}
					const callKey = { name: call.name, args: call.arguments };
					const observing =
						call.name === "process" && ["status", "log", "wait"].includes(String(call.arguments.action));
					state.repeats = observing ? 0 : isDeepStrictEqual(callKey, state.previous) ? state.repeats + 1 : 1;
					state.previous = structuredClone(callKey);
					await this.saveRun(state);
					if (state.repeats >= state.config.resolved.limits.repeatStop) await this.stop(context, state, "repeatStop");
					if (state.repeats >= state.config.resolved.limits.repeatBlock)
						return {
							block: `同一个 ${call.name} 调用已用相同参数重复 ${state.repeats} 次。先读上一次的结果；换参数或换方法；仍然不行就停下来，说明卡在哪里。`,
						};
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
