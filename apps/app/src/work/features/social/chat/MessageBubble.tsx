import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Actor, Message } from "../../../api/social";
import { cn } from "../../../lib/cn";
import { href } from "../../../shell/routes";
import { ActorAvatar } from "../../../ui/kit/ActorAvatar";

export function MessageBubble({
	message,
	sender,
	mine,
	group,
	first,
}: {
	message: Message;
	sender?: Actor;
	mine: boolean;
	group: boolean;
	first: boolean;
}) {
	const c = message.content;
	return (
		<li className={cn("flex items-end gap-2", mine && "flex-row-reverse", first && "mt-3")}>
			{!mine && sender && (
				<a
					href={href({ tab: "contacts", page: "contacts", session: sender.code ?? sender.id })}
					aria-label={`查看${sender.name}的资料`}
				>
					<ActorAvatar seed={sender.id} group={sender.kind === "agent" ? "bot" : "import"} size={32} />
				</a>
			)}
			<div className={cn("flex max-w-[80%] flex-col gap-1", mine && "items-end")}>
				{group && !mine && first && sender && (
					<span className="px-1 text-[12px] text-muted">
						{sender.name}
						{sender.kind === "agent" && " · Agent"}
					</span>
				)}
				<div className={cn("rounded-bubble px-3.5 py-2 text-[15px]", mine ? "bg-accent text-on-accent" : "bg-tone")}>
					{c.type === "text" && <p className="whitespace-pre-wrap">{c.text}</p>}
					{c.type === "markdown" && <ReactMarkdown remarkPlugins={[remarkGfm]}>{c.text}</ReactMarkdown>}
					{c.type === "image" && <img src={c.url} alt={c.name ?? ""} className="max-h-64 rounded-xl" />}
					{c.type === "file" && (
						<a href={c.url} className="underline">
							{c.name}
						</a>
					)}
					{c.type === "interactive" && (
						<div>
							<b>{c.title}</b>
							<p>{c.body}</p>
							{c.link &&
								c.actions.map((action) => (
									<a key={action.id} href={c.link} className="mr-2 underline">
										{action.label}
									</a>
								))}
						</div>
					)}
				</div>
			</div>
		</li>
	);
}
