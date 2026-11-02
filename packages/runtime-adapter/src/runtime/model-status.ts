import { BACKGROUND_CONTEXT as C } from "@earendil-works/chord/context";
import { DEFAULT_COMPACTION_POLICY, estimateContext, LiveDoc, selectCut } from "@earendil-works/pi-durable";
import { cid } from "./docs.js";
import type { RuntimeInternals } from "./instance.js";

export async function modelStatus(rt: RuntimeInternals, id: string) {
	await rt.configure(id);
	const conversation = await rt.conversation(id);
	const agent = await conversation.agent(C);
	const config = await rt.sessionConfig(id);
	const ref = agent.model;
	const model = ref ? (await rt.modelsFor(config)).getModel(ref.provider, ref.modelId) : undefined;
	const view = await conversation.context(C);
	const live = await rt.harness.snapshot(LiveDoc, cid(id), C);
	const policy = { ...DEFAULT_COMPACTION_POLICY, ...rt.options.config.compaction };
	const compactable = selectCut(view, policy.keepRecentTokens) !== undefined;
	const graph = await rt.harness.taskGraph(C);
	try {
		const all = Object.values(graph.value.tasks);
		const scope = new Set([Number(id)]);
		for (let changed = true; changed; ) {
			changed = false;
			for (const task of all)
				if (scope.has(task.conversationId))
					for (const child of task.conversations)
						if (!scope.has(child)) {
							scope.add(child);
							changed = true;
						}
		}
		return {
			model: model
				? { provider: model.provider, id: model.id, contextWindow: model.contextWindow, maxTokens: model.maxTokens }
				: null,
			thinking: agent.thinkingLevel,
			primary: config.resolved.model,
			fallback: config.resolved.fallback,
			failures: live?.run?.modelFallback?.failures ?? 0,
			running: !!live?.run,
			contextTokens: estimateContext(view, []),
			compact: {
				available: !live?.compactions?.length && compactable,
				reason: live?.compactions?.length ? "压缩进行中" : !compactable ? "尚无可压缩的较早上下文" : "可压缩",
				tasks: (live?.compactions ?? []).map((task) => String(task.taskId)),
				failure: live?.compactionFailure?.error,
			},
			tasks: await Promise.all(
				all
					.filter((task) => scope.has(task.conversationId))
					.map(async (task) => {
						const record = await rt.harness.getTask(task.id, C);
						const conversation = await rt.harness.conversation(task.conversationId, C);
						const native = await conversation?.agent(C);
						const checkpoint =
							record && record.state.status !== "terminal"
								? (record.state.checkpoint as {
										model?: { provider: string; modelId: string };
										thinkingLevel?: string;
									})
								: undefined;
						const selected = checkpoint?.model ?? native?.model;
						const input = record?.input as { name?: string; args?: { agent?: string } } | undefined;
						return {
							name: input?.name,
							model: selected ? `${selected.provider}/${selected.modelId}` : undefined,
							thinking: checkpoint?.thinkingLevel ?? native?.thinkingLevel,
							targetAgent: input?.name === "agent_ask" ? input.args?.agent : undefined,
							id: String(task.id),
							session: String(task.conversationId),
							kind: task.kind,
							owner: task.owner ? String(task.owner) : undefined,
							background: task.background,
							state: task.state.status,
						};
					}),
			),
		};
	} finally {
		graph.dispose();
	}
}
export async function compact(rt: RuntimeInternals, id: string, instructions?: string): Promise<string> {
	const status = await rt.modelStatus(id);
	if (!status.compact.available) throw new Error(status.compact.reason);
	return String(await (await rt.conversation(id)).compact(instructions, C));
}
