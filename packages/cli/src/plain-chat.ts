import { env, stderr, stdin, stdout } from "node:process";
import { createInterface } from "node:readline";
import { observeControl, requestControl, type TerminalUpdate } from "@yonder/core";
import type { SessionInfo, YEvent } from "@yonder/sdk";
import type { ChatTarget } from "./terminal.js";

/** 一轮没有任何进展（无输出、无工具、无结束）超过这个时长就放弃等待（JV2-J13-01）。 */
export const TURN_TIMEOUT_MS = 5 * 60 * 1000;

export interface PlainChatIo {
	input?: NodeJS.ReadableStream & { isTTY?: boolean };
	out?: NodeJS.WritableStream;
	err?: NodeJS.WritableStream;
	/** 单轮无进展超时；缺省读 YONDER_CHAT_TURN_TIMEOUT_MS，再退回 5 分钟。 */
	turnTimeoutMs?: number;
}

function turnTimeout(io: PlainChatIo) {
	if (io.turnTimeoutMs !== undefined) return io.turnTimeoutMs;
	const value = Number(env.YONDER_CHAT_TURN_TIMEOUT_MS);
	return Number.isFinite(value) && value > 0 ? value : TURN_TIMEOUT_MS;
}

/**
 * Line-oriented task client. EOF drains admitted inputs; disconnect never resubmits.
 * 轮次失败（task_failed、非 done 结束）或长时间无进展时以错误结束，调用方据此非 0 退出，不会永远挂起。
 */
export async function plainTaskChat(home: string, target: ChatTarget, json: boolean, io: PlainChatIo = {}) {
	const input = io.input ?? stdin,
		out = io.out ?? stdout,
		err = io.err ?? stderr;
	const timeoutMs = turnTimeout(io);
	const lines = createInterface({ input, output: json ? err : out, terminal: !!input.isTTY });
	const iterator = lines[Symbol.asyncIterator]();
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		let first = await iterator.next();
		while (!first.done && !first.value.trim()) first = await iterator.next();
		if (first.done) return;

		let session = target.session;
		const call = <T>(method: string, params: Record<string, unknown>) =>
			requestControl(home, { method, params }) as Promise<T>;
		if (!session)
			session = (await call<SessionInfo>("sessions.open", { preset: target.preset ?? "default", close: "manual" })).id;
		const id = session;
		const admitted = new Set<string>(),
			ended = new Set<string>(),
			finalized = new Map<string, string>();
		let live = "",
			liveActive = false,
			eof = false,
			failure: string | undefined;
		let finish!: () => void, fail!: (error: Error) => void;
		const drained = new Promise<void>((resolve, reject) => {
			finish = resolve;
			fail = reject;
		});
		// Attach a handler immediately so a disconnect while stdin is open cannot be unhandled.
		void drained.catch(() => {});
		const pending = () => [...admitted].some((event) => !ended.has(event));
		const complete = () => {
			if (!eof || pending()) return;
			if (failure) fail(new Error(failure));
			else finish();
		};
		// 有未结束的输入时才计时；任何进展都重新计时。
		const arm = () => {
			if (timer) clearTimeout(timer);
			timer = undefined;
			if (!pending()) return;
			timer = setTimeout(() => {
				lines.close();
				fail(
					new Error(
						`回复超时：${Math.round(timeoutMs / 1000)} 秒没有进展（模型可能不可用，运行 yonder doctor 查看）/ Reply timed out`,
					),
				);
			}, timeoutMs);
			timer.unref?.();
		};
		const endInputs = (inputs: string[]) => {
			for (const event of inputs) ended.add(event);
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
			if (json) out.write(`${JSON.stringify(packet)}\n`);
			else if (update.type === "notification" && update.notification)
				out.write(`[通知 · ${update.notification.from}] ${update.notification.text}\n`);
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
						out.write(text.startsWith(live) ? text.slice(live.length) : `\n${text}`);
						live = text;
					} else {
						const previous = finalized.get(update.id ?? "") ?? (liveActive ? live : "");
						out.write(text.startsWith(previous) ? text.slice(previous.length) : `\n${text}`);
						if (!finalized.has(update.id ?? "") && text) out.write("\n");
						finalized.set(update.id ?? "", text);
						liveActive = false;
					}
				}
			} else if (update.type === "tool" && update.tool?.phase === "start") err.write(`[${update.tool.name}]\n`);
			else if (update.type === "error") err.write(`${update.error}\n`);
			if (update.type === "error") failure = String(update.error ?? "run failed");
			// 运行时的 run_end（state running=false）也算这些输入结束：投递层的 run.end 缺席时不至于一直等。
			const state = update as { type: string; running?: boolean; inputs?: string[] };
			if (state.type === "state" && state.running === false && failure) endInputs(state.inputs ?? []);
			if (update.type === "end") {
				const data = (update.event as YEvent).data as { inputs: string[]; status: string; reason?: string };
				endInputs(data.inputs);
				if (data.status !== "done") {
					if (!json) err.write(`${data.status}: ${data.reason ?? ""}\n`);
					failure ??= `${data.status}: ${data.reason ?? ""}`.trim();
				} else failure = undefined;
			}
			arm();
			complete();
		});
		try {
			for (let next: IteratorResult<string> = first; !next.done; next = await iterator.next()) {
				const text = next.value;
				if (!text.trim()) continue;
				const accepted = await call<{ event: string }>("sessions.submit", { id, text });
				admitted.add(accepted.event);
				arm();
				if (json) out.write(`${JSON.stringify({ type: "accepted", session: id, ...accepted })}\n`);
			}
			eof = true;
			complete();
			await drained;
		} finally {
			lines.close();
			observation.close();
		}
	} finally {
		if (timer) clearTimeout(timer);
		lines.close();
	}
}
