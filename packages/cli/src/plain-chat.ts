import { stderr, stdin, stdout } from "node:process";
import { createInterface } from "node:readline";
import { observeControl, requestControl, type TerminalUpdate } from "@yonder/core";
import type { SessionInfo, YEvent } from "@yonder/sdk";
import type { ChatTarget } from "./terminal.js";

/** Line-oriented task client. EOF drains admitted inputs; disconnect never resubmits. */
export async function plainTaskChat(home: string, target: ChatTarget, json: boolean) {
	const lines = createInterface({ input: stdin, output: json ? stderr : stdout, terminal: stdin.isTTY });
	const iterator = lines[Symbol.asyncIterator]();
	try {
		let first = await iterator.next();
		while (!first.done && !first.value.trim()) first = await iterator.next();
		if (first.done) return;

		let session = target.session;
		const call = <T>(method: string, params: object) => requestControl(home, { method, params }) as Promise<T>;
		if (!session)
			session = (await call<SessionInfo>("sessions.open", { preset: target.preset ?? "default", close: "manual" })).id;
		const id = session;
		const admitted = new Set<string>(),
			ended = new Set<string>(),
			finalized = new Map<string, string>();
		let live = "",
			liveActive = false,
			eof = false;
		let finish!: () => void, fail!: (error: Error) => void;
		const drained = new Promise<void>((resolve, reject) => {
			finish = resolve;
			fail = reject;
		});
		// Attach a handler immediately so a disconnect while stdin is open cannot be unhandled.
		void drained.catch(() => {});
		const complete = () => {
			if (eof && [...admitted].every((event) => ended.has(event))) finish();
		};
		const observation = await observeControl(home, { method: "sessions.watch", params: { id } }, (packet) => {
			const envelope = packet as { type: string; update?: TerminalUpdate; error?: string };
			if (envelope.type === "disconnected") {
				lines.close();
				fail(new Error(envelope.error));
				return;
			}
			const update = envelope.update;
			if (!update) return;
			if (json) stdout.write(`${JSON.stringify(packet)}\n`);
			else if (update.type === "message" && update.message) {
				const message = update.message as { role: string; content?: Array<{ type: string; text?: string }> };
				if (message.role === "assistant") {
					const text = (message.content ?? [])
						.filter((block) => block.type === "text")
						.map((block) => block.text ?? "")
						.join("\n");
					if (update.id === "live") {
						if (!liveActive) {
							live = "";
							liveActive = true;
						}
						stdout.write(text.startsWith(live) ? text.slice(live.length) : `\n${text}`);
						live = text;
					} else {
						const previous = finalized.get(update.id ?? "") ?? (liveActive ? live : "");
						stdout.write(text.startsWith(previous) ? text.slice(previous.length) : `\n${text}`);
						if (!finalized.has(update.id ?? "") && text) stdout.write("\n");
						finalized.set(update.id ?? "", text);
						liveActive = false;
					}
				}
			} else if (update.type === "tool" && update.tool?.phase === "start") stderr.write(`[${update.tool.name}]\n`);
			else if (update.type === "error") stderr.write(`${update.error}\n`);
			if (update.type === "end") {
				const data = (update.event as YEvent).data as { inputs: string[]; status: string; reason?: string };
				for (const event of data.inputs) ended.add(event);
				if (!json && data.status !== "done") stderr.write(`${data.status}: ${data.reason ?? ""}\n`);
				complete();
			}
		});
		try {
			for (let next: IteratorResult<string> = first; !next.done; next = await iterator.next()) {
				const text = next.value;
				if (!text.trim()) continue;
				const accepted = await call<{ event: string }>("sessions.submit", { id, text });
				admitted.add(accepted.event);
				if (json) stdout.write(`${JSON.stringify({ type: "accepted", session: id, ...accepted })}\n`);
			}
			eof = true;
			complete();
			await drained;
		} finally {
			lines.close();
			observation.close();
		}
	} finally {
		lines.close();
	}
}
