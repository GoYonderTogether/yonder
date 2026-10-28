import type { ReactNode } from "react";
import type { Actor, Profile } from "../../api/social";
import { href } from "../../shell/routes";
import { ActorAvatar } from "../../ui/kit/ActorAvatar";
import { Markdown } from "../../ui/Markdown";
export function IdentityDetail({
	actor,
	card,
	summary,
	agents = [],
	owner,
	actions,
	children,
}: {
	actor: Actor;
	card?: Profile["card"];
	summary?: string | null;
	agents?: Actor[];
	owner?: Actor | null;
	actions?: ReactNode;
	children?: ReactNode;
}) {
	const face = card?.face;
	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-4 lg:px-8 lg:py-6">
			<section aria-label="身份资料" className="overflow-hidden rounded-[24px] bg-raised shadow-soft">
				<div className="h-32 bg-tone-2 lg:h-40">
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
				</div>
				<div className="flex flex-col gap-4 px-5 pb-5">
					<div className="flex items-start gap-4">
						<div className="-mt-7 rounded-full bg-raised p-1">
							<ActorAvatar seed={actor.id} group="bot" size={72} dot={actor.kind === "agent" && actor.online} />
						</div>
						<div className="pt-3">
							<h1 className="break-words text-[22px] font-semibold">{actor.name}</h1>
							{actor.code && <p className="text-small text-muted">ID · {actor.code}</p>}
							{actor.kind === "agent" && (
								<p className="text-small text-muted">Agent · {actor.online ? "在线" : "离线"}</p>
							)}
						</div>
					</div>
					{(face?.headline || card?.tagline || card?.summary || summary || actor.summary) && (
						<p className="break-words text-muted">
							{face?.headline || card?.tagline || card?.summary || summary || actor.summary}
						</p>
					)}
					{!!face?.tags?.length && (
						<div className="flex flex-wrap gap-2">
							{face.tags.map((t) => (
								<span key={t} className="rounded-full bg-tone px-3 py-1 text-small">
									{t}
								</span>
							))}
						</div>
					)}
					{actions}
				</div>
			</section>
			{(card?.markdown || face?.section) && (
				<section aria-label="介绍" className="rounded-card bg-raised p-5">
					<h2 className="mb-3 text-small text-muted">介绍</h2>
					{face?.section && (
						<div>
							<h3>{face.section.title}</h3>
							<p className="whitespace-pre-wrap">{face.section.body}</p>
						</div>
					)}
					{card?.markdown && <Markdown text={card.markdown} />}
				</section>
			)}
			{!!agents.length && (
				<section className="rounded-card bg-raised p-5">
					<h2>Agent</h2>
					<ul>
						{agents.map((a) => (
							<li key={a.id}>
								<a className="block py-2" href={href({ tab: "contacts", page: "contacts", session: a.code ?? a.id })}>
									{a.name}
								</a>
							</li>
						))}
					</ul>
				</section>
			)}
			{owner && (
				<section className="rounded-card bg-raised p-5">
					主人 · <a href={href({ tab: "contacts", page: "contacts", session: owner.code ?? owner.id })}>{owner.name}</a>
				</section>
			)}
			{children}
		</div>
	);
}
