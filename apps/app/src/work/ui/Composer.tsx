import { ArrowUp, Square } from "lucide-react";
import { useRef, useState } from "react";
import { RpcError, rpc } from "../api/client";
import { useActiveNode } from "../api/nodes";
import { useWorkOnline } from "../lib/workOnline";
import { AssistBar, AssistMenu, parseSlash, runCommand } from "./ComposerAssist";
import { AttachmentButton, AttachmentList, useAttachments } from "./ComposerAttachments";

const savedDrafts: Record<string, string> = {};
const unknownSends: Record<string, { text: string; method: string; params: Record<string, unknown> }> = {};

type Busy = "steer" | "followup" | "interrupt";

/**
 * 忙碌时可选择发送方式，随时可中止；中文输入法组字期间 Enter 不发送。
 * `bot` 是常驻 Bot 的 agent id：Bot 的 main 会话不是 task 会话，输入经控制台渠道 `bots.send`，
 * 由 Bot 自己的绑定接收（contracts.md §10），排队/打断不适用。
 */
export function Composer({ session, running, bot }: { session: string; running: boolean; bot?: string }) {
	const online = useWorkOnline();
	const node = useActiveNode();
	const draftKey = `${node.id}:${session}`;
	const [drafts, setDrafts] = useState<Record<string, string>>(savedDrafts);
	const text = drafts[draftKey] ?? "";
	const setText = (value: string) => {
		if (value !== savedDrafts[draftKey]) delete unknownSends[draftKey];
		savedDrafts[draftKey] = value;
		setDrafts((old) => ({ ...old, [draftKey]: value }));
	};
	const [mode, setMode] = useState<Busy>("steer");
	const [err, setErr] = useState("");
	const [busy, setBusy] = useState(false);
	const [dragging, setDragging] = useState(false);
	const files = useAttachments(node);
	const sending = useRef(false);
	const changeFiles = (action: () => void) => {
		delete unknownSends[draftKey];
		action();
	};

	const send = async () => {
		const t = text.trim();
		if (!online || (!t && !files.items.length) || !files.ready || sending.current) return;
		sending.current = true;
		setBusy(true);
		setErr("");
		try {
			const cmd = parseSlash(t);
			if (cmd && !files.items.length) {
				setText("");
				await runCommand(session, cmd);
				return;
			}
			const pending = unknownSends[draftKey];
			const request =
				pending?.text === t
					? pending
					: {
							text: t,
							method: bot ? "bots.send" : "sessions.submit",
							params: bot
								? {
										agent: bot,
										text: t,
										requestId: crypto.randomUUID(),
										...(files.attachments.length ? { attachments: files.attachments } : {}),
									}
								: {
										id: session,
										text: t,
										requestId: crypto.randomUUID(),
										...(files.attachments.length ? { attachments: files.attachments } : {}),
										...(running ? { busy: mode } : {}),
									},
						};
			try {
				await rpc(request.method, request.params);
				delete unknownSends[draftKey];
			} catch (error) {
				if (error instanceof RpcError && error.code === "outcome_unknown" && (savedDrafts[draftKey] ?? "").trim() === t)
					unknownSends[draftKey] = request;
				else delete unknownSends[draftKey];
				throw error;
			}
			setText("");
			files.clear();
		} catch (e) {
			setErr(e instanceof Error ? e.message : "发送失败");
		} finally {
			sending.current = false;
			setBusy(false);
		}
	};
	const abort = () =>
		void rpc("sessions.abort", { id: session }).catch((e) => setErr(e instanceof Error ? e.message : "中止失败"));

	return (
		<fieldset
			aria-label="消息和附件"
			className={`m-0 min-w-0 border-0 bg-ground px-3 pt-1.5 pb-1 ${dragging ? "ring-2 ring-inset ring-accent" : ""}`}
			onDragOver={(event) => {
				if (event.dataTransfer.types.includes("Files")) {
					event.preventDefault();
					setDragging(true);
				}
			}}
			onDragLeave={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
			}}
			onDrop={(event) => {
				event.preventDefault();
				setDragging(false);
				if (online && !busy && event.dataTransfer.files.length) changeFiles(() => files.add(event.dataTransfer.files));
			}}
		>
			{running && (
				<div
					className="mx-auto mb-2 flex max-w-[720px] items-center gap-2 text-caption text-muted"
					data-testid="busy-bar"
				>
					<span className="dot-hop inline-block size-1.5 rounded-full bg-online" />
					{bot ? "正在回复" : "正在运行，新消息将"}
					{!bot && (
						<fieldset aria-label="忙碌时发送方式" className="m-0 flex rounded-full border-0 bg-tone p-0.5">
							{(["steer", "followup", "interrupt"] as const).map((m) => (
								<button
									key={m}
									type="button"
									aria-pressed={mode === m}
									onClick={() => setMode(m)}
									className={`press rounded-full px-2.5 py-0.5 ${mode === m ? "bg-raised text-ink shadow-soft" : ""}`}
								>
									{m === "steer" ? "插话" : m === "followup" ? "排队" : "打断"}
								</button>
							))}
						</fieldset>
					)}
					<button
						type="button"
						onClick={abort}
						disabled={!online}
						className="press ml-auto flex items-center gap-1 rounded-full bg-tone px-2.5 py-0.5 text-danger"
						data-testid="abort"
					>
						<Square size={11} aria-hidden /> 中止
					</button>
				</div>
			)}
			{!bot && <AssistBar onInvite={() => setText("@")} />}
			<AssistMenu text={text} session={session} onPick={setText} />
			{err && (
				<p role="alert" className="mx-auto mb-1 max-w-[720px] text-caption text-danger">
					{err}
				</p>
			)}
			<AttachmentList
				items={files.items}
				disabled={busy}
				onRemove={(id) => changeFiles(() => files.remove(id))}
				onRetry={(item) => void files.retry(item)}
			/>
			{dragging && <p className="mx-auto mb-1 max-w-[900px] text-caption text-accent-ink">松开以添加图片或文件</p>}
			{/* 输入条是一整块浮起的纸面：聚焦时整块出现双环咬合，而不是只框住 textarea */}
			<div className="field mx-auto flex max-w-[900px] items-end gap-2 rounded-field border border-hairline bg-raised p-1.5 pl-1 shadow-soft">
				<AttachmentButton disabled={!online || busy} onFiles={(selected) => changeFiles(() => files.add(selected))} />
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
					className="max-h-40 min-h-9 min-w-0 flex-1 resize-none rounded-field bg-transparent px-1 py-1.5 text-body outline-none placeholder:text-faint"
				/>
				<button
					type="button"
					onClick={() => void send()}
					disabled={!online || busy || !files.ready || (!text.trim() && !files.items.length)}
					aria-label="发送"
					className="press grid size-9 shrink-0 place-items-center rounded-full bg-accent text-on-accent transition-opacity disabled:opacity-25"
				>
					<ArrowUp size={18} aria-hidden />
				</button>
			</div>
		</fieldset>
	);
}
