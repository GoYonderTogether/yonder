import type { Runtime } from "../runtime/index.js";
import type { Store } from "../store/index.js";
import type { Workbench } from "./workbench.js";

/** 截取首行：含中文最多 10 字，否则最多 7 个单词。 */
export function cleanTitle(text: string): string {
	const line = (text.split("\n").find((part) => part.trim()) ?? "")
		.replace(/^["'“”‘’「『《\s#*]+|["'“”‘’」』》\s。.!！*]+$/g, "")
		.trim();
	return /\p{Script=Han}/u.test(line) ? [...line].slice(0, 10).join("") : line.split(/\s+/).slice(0, 7).join(" ");
}

/**
 * Names a session after its first finished run (contracts §18 title). Uses the cheapest model of the session's
 * chain once; a failure is reported, never retried. A title set by anyone, including a rename made while the
 * model was answering, is never overwritten.
 */
export async function autoTitle({
	id,
	input,
	reply,
	store,
	runtime,
	workbench,
}: {
	id: string;
	input: string;
	reply: string;
	store: Store;
	runtime: Runtime;
	workbench: Pick<Workbench, "rename">;
}): Promise<string | undefined> {
	if (!input.trim() || (await store.sessions.get(id))?.title) return undefined;
	const { resolved } = await runtime.sessionConfig(id);
	const ref = resolved.cheap ?? resolved.simple ?? resolved.model;
	const slash = ref.indexOf("/");
	const model = runtime.models.getModel(ref.slice(0, slash), ref.slice(slash + 1));
	if (!model) return undefined;
	const prompt = `请为下面这段对话起一个标题，中文不超过 10 字，英文不超过 7 词，只输出标题本身，不加引号和标点。\n\n用户：${input.slice(0, 600)}\n\n回复：${reply.slice(0, 600)}`;
	const message = await runtime.models
		.streamSimple(
			model,
			{ messages: [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }] },
			{ maxTokens: 512, signal: AbortSignal.timeout(30000) },
		)
		.result();
	if (message.stopReason === "error") throw new Error(message.errorMessage ?? "title model failed");
	const title = cleanTitle(message.content.map((part) => (part.type === "text" ? part.text : "")).join(""));
	if (!title || (await store.sessions.get(id))?.title) return undefined;
	await workbench.rename(id, title);
	return title;
}
