import { AtSign, Slash } from "lucide-react";
import { archiveSession } from "../api/work";
import { groupOf } from "../lib/identity";
import { useSessions, useTitleOf } from "../lib/queries";
import { toast } from "./kit/Toast";

/** 内核已有 bot_attach（契约 §18），界面还没有选 Bot 的流程：入口做出来，点了如实说明怎么走。 */
export const INVITE_PENDING =
	"邀请 Bot 参与还没接到界面：节点已支持 bot_attach（契约 §18），可以让助手把当前会话挂到某个 Bot 下。";
export const invitePending = () => toast(INVITE_PENDING, true);

export interface SlashCommand {
	key: string;
	label: string;
	hint: string;
	run(): void;
}

/** / 命令：归档是本机真实动作；邀请与分出依赖后端，如实提示。 */
export function slashCommands(session: string): SlashCommand[] {
	return [
		{ key: "invite", label: "/邀请", hint: "邀请 Bot 一起做", run: invitePending },
		{ key: "archive", label: "/归档", hint: "标为已完成", run: () => void archiveSession(session) },
	];
}

/** 输入框上方的浮动入口：[@ 邀请]。 */
export function AssistBar() {
	return (
		<div className="mx-auto mb-1.5 flex max-w-[720px] gap-2" data-testid="assist-bar">
			<button
				type="button"
				onClick={invitePending}
				className="press flex items-center gap-1 rounded-full border border-hairline bg-raised px-2.5 py-1 text-caption text-muted"
				data-testid="invite-bot"
			>
				<AtSign size={12} aria-hidden /> 邀请
			</button>
		</div>
	);
}

/** 输入 @ 或 / 时弹出的候选：@ 列出 Bot，/ 列出命令。 */
export function AssistMenu(p: { text: string; session: string; onPick(replace: string): void }) {
	// 只在输入 @ 或 / 时才挂载（含查询），平时输入框不依赖查询环境
	return /(?:^|\s)@\S*$|^\/\S*$/.test(p.text) ? <AssistList {...p} /> : null;
}

function AssistList({ text, session, onPick }: { text: string; session: string; onPick(replace: string): void }) {
	const titleOf = useTitleOf();
	const sessions = useSessions();
	const at = /(?:^|\s)@(\S*)$/.exec(text);
	const slash = /^\/(\S*)$/.exec(text);
	const bots = (sessions.data ?? []).filter((s) => groupOf(s) === "bot" && !s.closed);
	return (
		<div
			role="menu"
			className="mx-auto mb-1.5 max-w-[720px] rounded-card bg-raised p-1 shadow-float"
			data-testid="assist-menu"
		>
			{at &&
				(bots.length === 0 ? (
					<p className="px-3 py-2 text-caption text-faint">没有可邀请的 Bot</p>
				) : (
					bots.map((s) => (
						<button
							key={s.id}
							type="button"
							role="menuitem"
							onClick={() => {
								invitePending();
								onPick(text.replace(/@\S*$/, ""));
							}}
							className="press flex w-full items-center gap-2 rounded-control px-3 py-2 text-left text-small hover:bg-tone"
						>
							<AtSign size={13} className="text-faint" aria-hidden />
							{titleOf(s)}
						</button>
					))
				))}
			{slash &&
				slashCommands(session)
					.filter((c) => c.label.startsWith(`/${slash[1]}`))
					.map((c) => (
						<button
							key={c.key}
							type="button"
							role="menuitem"
							onClick={() => {
								c.run();
								onPick("");
							}}
							className="press flex w-full items-center gap-2 rounded-control px-3 py-2 text-left text-small hover:bg-tone"
						>
							<Slash size={13} className="text-faint" aria-hidden />
							{c.label}
							<span className="text-caption text-faint">{c.hint}</span>
						</button>
					))}
		</div>
	);
}
