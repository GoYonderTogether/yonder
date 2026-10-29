import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Actor, Message } from "../../../api/social";
import { cn } from "../../../lib/cn";
import { href } from "../../../shell/routes";
import { SocialAvatar } from "../IdentityAvatar";

/** 连续同一个人：只有第一条给足上间距、只有最后一条带头像，中间的气泡内角收成 6px。 */
export function MessageBubble({
	message,
	sender,
	mine,
	group,
	first,
	last,
}: {
	message: Message;
	sender?: Actor;
	mine: boolean;
	group: boolean;
	first: boolean;
	last: boolean;
}) {
	const c = message.content;
	const tight = mine
		? { borderTopRightRadius: first ? undefined : 6, borderBottomRightRadius: last ? undefined : 6 }
		: { borderTopLeftRadius: first ? undefined : 6, borderBottomLeftRadius: last ? undefined : 6 };
	return (
		<li className={cn("rise flex items-end gap-2", mine && "flex-row-reverse", first && "mt-3")}>
			{!mine && (
				<span className="w-8 shrink-0">
					{last && sender && (
						<a
							href={href({ tab: "contacts", page: "contacts", session: sender.code ?? sender.id })}
							aria-label={`查看${sender.name}的资料`}
						>
							<SocialAvatar actor={sender} size={32} />
						</a>
					)}
				</span>
			)}
			<div className={cn("flex max-w-[80%] flex-col gap-1", mine && "items-end")}>
				{group && !mine && first && sender && (
					<span className="px-1 text-caption text-muted">
						{sender.name}
						{sender.kind === "agent" && " · Agent"}
					</span>
				)}
				<div
					style={tight}
					className={cn("rounded-bubble px-3.5 py-2 text-body", mine ? "bg-accent text-on-accent" : "bg-tone")}
				>
					{c.type === "text" && <p className="whitespace-pre-wrap">{c.text}</p>}
					{c.type === "markdown" && (
						<div className="md">
							<ReactMarkdown remarkPlugins={[remarkGfm]}>{c.text}</ReactMarkdown>
						</div>
					)}
					{c.type === "image" && <img src={c.url} alt={c.name ?? ""} className="max-h-64 rounded-xl" />}
					{c.type === "file" && (
						<a href={c.url} className="underline underline-offset-2">
							{c.name}
						</a>
					)}
					{c.type === "interactive" && (
						<div className="flex flex-col gap-2 py-0.5">
							<b className="font-semibold">{c.title}</b>
							<p className="text-muted">{c.body}</p>
							<div className="flex gap-2">
								{c.actions.map((action) => (
									<a
										key={action.id}
										href={c.link ?? "#"}
										className="press inline-flex h-8 items-center rounded-full bg-accent px-3 text-[13px] font-medium text-on-accent"
									>
										{action.label}
									</a>
								))}
							</div>
						</div>
					)}
				</div>
			</div>
		</li>
	);
}
