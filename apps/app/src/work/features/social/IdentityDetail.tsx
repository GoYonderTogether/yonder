import type { ReactNode } from "react";
import type { Actor, Profile } from "../../api/social";
import { href } from "../../shell/routes";
import { Markdown } from "../../ui/Markdown";
import { SocialAvatar, Status } from "./IdentityAvatar";
import { THEMES } from "./card/themes";

/**
 * 资料页的身份头图 + 介绍，与名片站 components/IdentityDetail 同一套版式：
 * 24px 圆角大卡、h-32/h-40 渐变封面、头像上浮 -28px、五档字号与 rounded-full 标签。
 * 公开页与内部资料页共用；差别只在 actions / qr / children。
 */
export function IdentityDetail({
	actor,
	card,
	summary,
	agents = [],
	owner,
	actions,
	qr,
	children,
}: {
	actor: Actor;
	card?: Profile["card"];
	summary?: string | null;
	agents?: Actor[];
	owner?: Actor | null;
	actions?: ReactNode;
	qr?: ReactNode;
	children?: ReactNode;
}) {
	const face = card?.face;
	const palette = THEMES[face?.theme ?? "mist"];
	const headline = face?.headline?.trim() || card?.tagline || card?.summary || summary || actor.summary;
	const agent = actor.kind === "agent";
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
							<SocialAvatar actor={actor} size={72} online={agent ? !!actor.online : undefined} />
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
				<section aria-label="Agent" className="overflow-hidden rounded-card bg-raised">
					<h2 className="px-5 pt-4 pb-2 text-small font-medium text-muted">Agent</h2>
					<ul className="divide-y divide-hairline">
						{agents.map((a) => (
							<li key={a.id}>
								<a
									className="press flex items-center gap-3 px-5 py-4 hover:bg-tone/60"
									href={href({ tab: "contacts", page: "contacts", session: a.code ?? a.id })}
								>
									<SocialAvatar actor={a} size={40} online={!!a.online} />
									<span className="min-w-0 flex-1">
										<span className="block truncate font-medium">{a.name}</span>
										{a.summary && <span className="mt-1 line-clamp-2 block text-small text-muted">{a.summary}</span>}
									</span>
									<span className="text-caption text-muted">{a.online ? "在线" : "离线"}</span>
								</a>
							</li>
						))}
					</ul>
				</section>
			)}
			{owner && (
				<section className="rounded-card bg-raised px-5 py-4">
					<h2 className="mb-3 text-small font-medium text-muted">主人</h2>
					<a
						href={href({ tab: "contacts", page: "contacts", session: owner.code ?? owner.id })}
						className="press flex items-center gap-3"
					>
						<SocialAvatar actor={owner} size={40} />
						<span className="font-medium">{owner.name}</span>
					</a>
				</section>
			)}
			{children}
		</div>
	);
}
