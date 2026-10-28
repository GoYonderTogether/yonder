import type { SessionModels } from "@yonder/sdk";
import { Check } from "typebox/value";
import type { ResolvedProfile } from "../config/index.js";
import { SessionModelsSchema } from "../config/schema.js";
import type { Runtime } from "../runtime/index.js";

export function modelList(runtime: Runtime, args: string[]): string {
	if (args.length > 2) throw new Error("用法：/model list [provider]");
	const all = runtime.models.getProviders();
	if (!args[1])
		return `供应商：\n${all.map((p) => `${p.id} · ${p.getModels().length} models`).join("\n")}\n/model list <provider> 查看模型`;
	const selected = all.find((p) => p.id === args[1]);
	if (!selected) throw new Error(`Unknown provider: ${args[1]}`);
	return (
		selected
			.getModels()
			.map((m) => `${selected.id}/${m.id} · context ${m.contextWindow} · output ${m.maxTokens}`)
			.join("\n") || "无模型"
	);
}

export async function configureModel(
	runtime: Runtime,
	id: string,
	name: string,
	args: string[],
	selected: ResolvedProfile,
) {
	const saved = (await runtime.sessionState(id))?.models ?? {};
	let next: SessionModels | null;
	const legacyEffort = name === "model" && args[0] === "effort";
	const level = name === "effort" ? args[0] : legacyEffort && args.length === 2 ? args[1] : undefined;
	if (level === "auto") {
		next = { ...saved };
		delete next.thinking;
	} else if (level !== undefined) next = { ...saved, thinking: level as NonNullable<SessionModels["thinking"]> };
	else if (args[0] === "reset" && args.length === 1) next = null;
	else if (args[0] === "after" && args.length === 2)
		next = {
			...saved,
			fallback: { ...selected.fallback, models: selected.fallback?.models ?? [], after: Number(args[1]) },
		};
	else if (args.every((arg) => /^[^/]+\/.+$/.test(arg)))
		next = {
			...saved,
			model: args[0]!,
			fallback: { ...selected.fallback, models: args.slice(1), after: selected.fallback?.after ?? 3 },
		};
	else throw new Error("用法：/model <provider/model> [fallback ...] | after <次数> | reset");
	if (next && !Check(SessionModelsSchema, next))
		throw new Error("无效模型设置：effort 必须是 off/minimal/low/medium/high/xhigh/max，after 必须是正整数");
	for (const ref of [next?.model, ...(next?.fallback?.models ?? [])].filter((ref): ref is string => !!ref)) {
		const slash = ref.indexOf("/");
		if (!runtime.models.getModel(ref.slice(0, slash), ref.slice(slash + 1))) throw new Error(`Unknown model: ${ref}`);
	}
	await runtime.configureModels(id, next);
	const changed = (await runtime.hasPendingWork(id)) ? "设置已保存，下次运行生效。\n" : "会话模型设置已保存。\n";
	return changed + (legacyEffort ? "`/model effort` 已弃用，请改用 /effort；最早 0.5 移除。\n" : "");
}
