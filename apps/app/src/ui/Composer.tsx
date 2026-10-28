import { ArrowUp, Square } from "lucide-react";
import { useRef, useState } from "react";
import { rpc } from "../transport/client";

type Busy = "followup" | "interrupt";

/**
 * 忙碌时可选「排队」或「打断」再发送，随时可中止；中文输入法组字期间 Enter 不发送。
 * `bot` 是常驻 Bot 的 agent id：Bot 的 main 会话不是 task 会话，输入经控制台渠道 `bots.send`，
 * 由 Bot 自己的绑定接收（contracts.md §10），排队/打断不适用。
 */
export function Composer({ session, running, bot }: { session: string; running: boolean; bot?: string }) {
	const [text, setText] = useState("");
	const [mode, setMode] = useState<Busy>("followup");
	const [err, setErr] = useState("");
	const sending = useRef(false);

	const send = async () => {
		const t = text.trim();
		if (!t || sending.current) return;
		sending.current = true;
		setErr("");
		try {
			if (bot) await rpc("bots.send", { agent: bot, text: t, requestId: crypto.randomUUID() });
			else
				await rpc("sessions.submit", {
					id: session,
					text: t,
					requestId: crypto.randomUUID(),
					...(running ? { busy: mode } : {}),
				});
			setText("");
		} catch (e) {
			setErr(e instanceof Error ? e.message : "发送失败");
		} finally {
			sending.current = false;
		}
	};
	const abort = () =>
		void rpc("sessions.abort", { id: session }).catch((e) => setErr(e instanceof Error ? e.message : "中止失败"));

	return (
		<div className="border-t border-hairline bg-ground px-3 pt-2 pb-2">
			{running && (
				<div
					className="mx-auto mb-2 flex max-w-[720px] items-center gap-2 text-caption text-muted"
					data-testid="busy-bar"
				>
					<span className="dot-hop inline-block size-1.5 rounded-full bg-online" />
					{bot ? "正在回复" : "正在运行，新消息将"}
					{!bot && (
						<fieldset aria-label="忙碌时发送方式" className="m-0 flex rounded-full border-0 bg-tone p-0.5">
							{(["followup", "interrupt"] as const).map((m) => (
								<button
									key={m}
									type="button"
									aria-pressed={mode === m}
									onClick={() => setMode(m)}
									className={`press rounded-full px-2.5 py-0.5 ${mode === m ? "bg-raised text-ink shadow-soft" : ""}`}
								>
									{m === "followup" ? "排队" : "打断"}
								</button>
							))}
						</fieldset>
					)}
					<button
						type="button"
						onClick={abort}
						className="press ml-auto flex items-center gap-1 rounded-full border border-hairline px-2.5 py-0.5 text-danger"
						data-testid="abort"
					>
						<Square size={11} aria-hidden /> 中止
					</button>
				</div>
			)}
			{err && (
				<p role="alert" className="mx-auto mb-1 max-w-[720px] text-caption text-danger">
					{err}
				</p>
			)}
			<div className="mx-auto flex max-w-[720px] items-end gap-2">
				<textarea
					value={text}
					rows={1}
					onChange={(e) => setText(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
							e.preventDefault();
							void send();
						}
					}}
					placeholder={running ? "继续输入…" : "发消息"}
					aria-label="消息输入框"
					className="field max-h-40 min-h-10 flex-1 resize-none rounded-[20px] bg-tone px-4 py-2.5 text-body outline-none"
				/>
				<button
					type="button"
					onClick={() => void send()}
					disabled={!text.trim()}
					aria-label="发送"
					className="press grid size-10 shrink-0 place-items-center rounded-full bg-accent text-on-accent disabled:opacity-30"
				>
					<ArrowUp size={18} aria-hidden />
				</button>
			</div>
		</div>
	);
}
