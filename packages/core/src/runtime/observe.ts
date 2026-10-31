import { BACKGROUND_CONTEXT as C } from "@earendil-works/chord/context";
import { UsageDoc } from "@earendil-works/pi-durable";
import type { TranscriptItem } from "@yonder/sdk";
import { cid, emptyUsage } from "./docs.js";
import type { RuntimeInternals } from "./instance.js";
import { observeTerminal, type TerminalUpdate } from "./terminal.js";
import { transcriptPage } from "./transcript.js";
import type { RuntimeRun } from "./types.js";

export async function observe(rt: RuntimeInternals, id: string, send: (update: TerminalUpdate) => Promise<void>) {
	let runId: string | undefined,
		eventIds: string[] = [];
	return observeTerminal(rt.harness, id, async (update) => {
		if (update.inputs) {
			runId = update.inputs[0];
			eventIds = (await rt.sources(update.inputs.map(Number))).map((event) => event.id);
		}
		await send({ ...update, session: id, ...(runId ? { runId } : {}), eventIds });
	});
}
export async function terminalHistory(rt: RuntimeInternals, id: string) {
	const page = await (await rt.conversation(id)).entries({ order: "ascending" }, Number.MAX_SAFE_INTEGER, undefined, C);
	return page.items.flatMap((entry) => entry.model ?? []);
}
export async function transcript(
	rt: RuntimeInternals,
	id: string,
	range: { from?: number; limit?: number; before?: number } = {},
): Promise<TranscriptItem[]> {
	return transcriptPage(await rt.conversation(id), range, rt.options.db);
}
export async function sessionUsage(rt: RuntimeInternals, id: string): Promise<RuntimeRun["usage"]> {
	const state = await rt.harness.snapshot(UsageDoc, cid(id), C),
		sum = emptyUsage();
	for (const usage of [...Object.values(state?.models ?? {}), ...Object.values(state?.tools ?? {})]) {
		sum.input += usage.input;
		sum.output += usage.output;
		sum.cacheRead += usage.cacheRead;
		sum.cacheWrite += usage.cacheWrite;
		sum.cost += usage.cost.total;
	}
	return sum;
}
