import { AtSign, Slash } from "lucide-react";
import { rpc } from "../api/client";
import { archiveSession } from "../api/work";
import { groupOf } from "../lib/identity";
import { useSessions, useTitleOf } from "../lib/queries";
import { toast } from "./kit/Toast";

/** 会话命令（网关 sessions.command，仅 model / effort / status / compact）；结果与错误都以提示呈现。 */
export async function runCommand(session: string, command: string): Promise<void> {
	try {
		toast(await rpc<string>("sessions.command", { id: session, command }));
	} catch (e) {
		toast(e instanceof Error ? e.message : "命令失败", true);
	}
}

/** 邀请 Bot：没有专门的网关方法，请助手调用内核 bot_attach 把当前会话挂到该 Bot 下（契约 §18）。 */
export async function inviteBot(session: string, bot: string, name = bot): Promise<void> {
	try {
		await rpc("sessions.submit", {
			id: session,
			text: `@${name} 请调用 bot_attach，把当前会话挂到 Bot ${bot} 下，邀请它一起处理。`,
			requestId: crypto.randomUUID(),
		});
		toast(`已请助手邀请 ${name}`);
	} catch (e) {
		toast(e instanceof Error ? e.message : "邀请失败", true);
	}
}

export interface SlashCommand {
	key: string;
	label: string;
	hint: string;
	/** 需要继续输入的命令：选中后把这段文字填进输入框，不直接执行。 */
	fill?: string;
	run(): void;
}

const ALIASES: Record<string, string> = { "/模型": "model", "/思考": "effort", "/状态": "status", "/压缩": "compact" };

/** 输入的整行是 /模型 /思考 /状态 /压缩 [参数] 时返回对应 sessions.command 文本，否则 null。 */
export function parseSlash(text: string): string | null {
	const [head, ...rest] = text.trim().split(/\s+/);
	const name = head ? ALIASES[head] : undefined;
	return name ? [name, ...rest].join(" ") : null;
}

/** / 命令：归档是本机真实动作；模型/思考/状态/压缩走 sessions.command。 */
export function slashCommands(session: string): SlashCommand[] {
	return [
		{ key: "invite", label: "/邀请", hint: "邀请 Bot 一起做", fill: "@", run: () => {} },
		{ key: "archive", label: "/归档", hint: "标为已完成", run: () => void archiveSession(session) },
		{ key: "model", label: "/模型", hint: "查看或切换模型，如 /模型 provider/id", fill: "/模型 ", run: () => {} },
		{ key: "effort", label: "/思考", hint: "思考档位，如 /思考 high 或 auto", fill: "/思考 ", run: () => {} },
		{ key: "status", label: "/状态", hint: "当前模型与会话状态", run: () => void runCommand(session, "status") },
		{ key: "compact", label: "/压缩", hint: "压缩上下文", run: () => void runCommand(session, "compact") },
	];
}

/** 输入框上方的浮动入口：[@ 邀请]。 */
export function AssistBar({ onInvite }: { onInvite(): void }) {
	return (
		<div className="mx-auto mb-1.5 flex max-w-[720px] gap-2" data-testid="assist-bar">
			<button
				type="button"
				onClick={onInvite}
				className="press flex items-center gap-1 rounded-full bg-tone px-2.5 py-1 text-caption text-muted"
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
								void inviteBot(session, s.agent ?? s.profile, titleOf(s));
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
								if (c.fill) onPick(c.fill);
								else {
									c.run();
									onPick("");
								}
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
