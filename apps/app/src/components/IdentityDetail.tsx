import { type ReactNode, useState } from "react";
import { Link, useLocation } from "react-router";
import type { Actor, Profile } from "../api/types";
import { entityRef } from "../lib/entityRef";
import { internalState } from "../lib/navigation";
import { Avatar, Status } from "../ui/Avatar";
import { THEMES } from "./card/themes";
import { Markdown } from "./Markdown";

/** Public and internal profiles share the same compact identity header and introduction. */
export function IdentityDetail({
	actor,
	card,
	summary,
	agents = [],
	owner,
	actions,
	qr,
	children,
	publicView = false,
}: {
	actor: Actor;
	card?: Profile["card"];
	summary?: string | null;
	agents?: Actor[];
	owner?: Actor | null;
	actions?: ReactNode;
	qr?: ReactNode;
	children?: ReactNode;
	publicView?: boolean;
}) {
	const loc = useLocation();
	const [expandedFor, setExpandedFor] = useState<string | null>(null);
	const expanded = expandedFor === actor.id;
	const visibleAgents = publicView && !expanded ? agents.slice(0, 3) : agents;
	const agent = actor.kind === "agent";
	const href = (a: Actor) => `${publicView ? "/p" : "/contacts"}/${entityRef(a)}`;
	const face = card?.face;
	const palette = THEMES[face?.theme ?? "mist"];
	const headline = face?.headline?.trim() || card?.tagline || card?.summary || summary || actor.summary;
	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-4 lg:px-8 lg:py-6">
			<section aria-label="身份资料" className="overflow-hidden rounded-[24px] bg-raised shadow-soft">
				<div
					className="relative h-32 overflow-hidden lg:h-40"
					style={{ background: `linear-gradient(120deg,${palette.from},${palette.to})` }}
				>
					{card?.display ? (
						<iframe
							title="资料背景"
							sandbox=""
							srcDoc={
								card.display.kind === "svg"
									? `<style>html,body{margin:0;height:100%}svg{display:block;width:100%;height:100%}</style>${card.display.source}`
									: card.display.source
							}
							className="pointer-events-none h-full w-full border-0"
						/>
					) : face?.sticker?.url ? (
						<img src={face.sticker.url} alt="" className="h-full w-full object-cover" />
					) : null}
					<div className="pointer-events-none absolute inset-0 bg-ground/30" />
				</div>
				<div className="relative flex flex-col gap-4 px-5 pb-5">
					<div className="flex items-start gap-4">
						<div className="-mt-7 shrink-0 rounded-full bg-raised p-1">
							<Avatar actor={actor} size={72} online={agent ? !!actor.online : undefined} />
						</div>
						<div className="min-w-0 flex-1 pt-3">
							<h1 className="break-words text-[22px] leading-tight font-semibold tracking-tight">{actor.name}</h1>
							{actor.code && <p className="mt-1 select-text text-caption text-muted">ID · {actor.code}</p>}
							{agent && (
								<p className="mt-1 flex items-center gap-1.5 text-caption text-muted">
									<Status online={!!actor.online} />
									Agent · {actor.online ? "在线" : "离线"}
								</p>
							)}
						</div>
						{qr && <div className="shrink-0 pt-2">{qr}</div>}
					</div>
					{headline && <p className="break-words text-body leading-relaxed text-muted">{headline}</p>}
					{!!face?.tags?.length && (
						<div className="flex flex-wrap gap-2">
							{face.tags.map((tag) => (
								<span key={tag} className="rounded-full bg-tone px-3 py-1 text-caption text-muted">
									{tag}
								</span>
							))}
						</div>
					)}
					{actions}
				</div>
			</section>
			{(card?.markdown || face?.section) && (
				<section aria-label="介绍" className="flex flex-col gap-4 rounded-card bg-raised p-5">
					<h2 className="text-small font-medium text-muted">介绍</h2>
					{face?.section && (
						<div className="break-words">
							<h3 className="font-medium">{face.section.title}</h3>
							<p className="mt-1 whitespace-pre-wrap text-body text-muted">{face.section.body}</p>
						</div>
					)}
					{card?.markdown && (
						<article className="break-words text-body">
							<Markdown text={card.markdown} />
						</article>
					)}
				</section>
			)}
			{!!agents.length && (
				<section aria-label={publicView ? "公开 Agent" : "Agent"} className="overflow-hidden rounded-card bg-raised">
					<h2 className="px-5 pt-4 pb-2 text-small font-medium text-muted">{publicView ? "公开 Agent" : "Agent"}</h2>
					<div className="divide-y divide-hairline">
						{visibleAgents.map((a) => (
							<Link
								key={a.id}
								to={href(a)}
								state={internalState(loc)}
								className="press flex items-center gap-3 px-5 py-4 hover:bg-tone/60"
							>
								<Avatar actor={a} size={40} online={!!a.online} />
								<div className="min-w-0 flex-1">
									<p className="truncate font-medium">{a.name}</p>
									{a.summary && <p className="mt-1 line-clamp-2 text-small text-muted">{a.summary}</p>}
								</div>
								<span className="text-caption text-muted">{a.online ? "在线" : "离线"}</span>
							</Link>
						))}
					</div>
					{publicView && agents.length > 3 && (
						<button
							type="button"
							aria-expanded={expanded}
							onClick={() => setExpandedFor(expanded ? null : actor.id)}
							className="press w-full border-t border-hairline px-5 py-3 text-left text-small hover:bg-tone/60"
						>
							{expanded ? "收起" : `查看全部 ${agents.length} 位`}
						</button>
					)}
				</section>
			)}
			{owner && (
				<section className="rounded-card bg-raised px-5 py-4">
					<h2 className="mb-3 text-small font-medium text-muted">主人</h2>
					<Link to={href(owner)} state={internalState(loc)} className="press flex items-center gap-3">
						<Avatar actor={owner} size={40} />
						<span className="font-medium">{owner.name}</span>
					</Link>
				</section>
			)}
			{children}
		</div>
	);
}
