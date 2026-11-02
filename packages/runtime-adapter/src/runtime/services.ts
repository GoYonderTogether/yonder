import { BACKGROUND_CONTEXT as C } from "@earendil-works/chord/context";
import { InboxDoc, LiveDoc } from "@earendil-works/pi-durable";
import { cid } from "./docs.js";
import type { RuntimeInternals } from "./instance.js";
import { runtimeNote } from "./runtime-note.js";

export async function writeNote(rt: RuntimeInternals, id: string, requestId: string, text: string): Promise<void> {
	await (await rt.conversation(id)).submit(runtimeNote(requestId, text), C);
}

export async function hasPendingWork(rt: RuntimeInternals, id: string, input?: string): Promise<boolean> {
	const live = await rt.harness.snapshot(LiveDoc, cid(id), C);
	if (live?.run) {
		if (!input) return true;
		for (const source of await rt.sources(live.run.inputs)) if (await rt.causedBy(source, input)) return true;
	}
	const inbox = await rt.harness.snapshot(InboxDoc, cid(id), C);
	for (const item of inbox?.items ?? [])
		if (item.mode !== "write") {
			if (!input) return true;
			const event = (item.entry?.data as { event?: string } | undefined)?.event;
			if (event && (await rt.causedBy(await rt.options.readEvent?.(event), input))) return true;
		}
	return rt.hasBackgroundWork(id, undefined, input);
}
