import type { Actor, Card } from "../../../api/social";
import { THEMES } from "./themes";

export function CardFaceView({ actor, card }: { actor: Actor; card?: Card }) {
	const face = card?.face;
	const theme = THEMES[face?.theme ?? "mist"];
	const line = face?.headline || card?.tagline || card?.summary;
	return (
		<div
			className="relative flex aspect-[3/4.3] w-full flex-col overflow-hidden rounded-[8%] shadow-lg"
			style={{ background: theme.bg, color: theme.fg }}
		>
			<div
				className="grid h-[42%] place-items-center overflow-hidden"
				style={{ background: `linear-gradient(${theme.from}, ${theme.to})` }}
			>
				{card?.display ? (
					<iframe
						title="展示卡片"
						sandbox=""
						srcDoc={
							card?.display.kind === "svg"
								? `<style>html,body{margin:0;height:100%}svg{width:100%;height:100%}</style>${card?.display.source}`
								: card?.display.source
						}
						className="pointer-events-none h-full w-full border-0"
					/>
				) : face?.sticker?.url ? (
					<img src={face.sticker.url} alt="" className="h-3/4 w-3/4 object-cover" />
				) : (
					<span className="text-3xl font-extrabold">{actor.name}</span>
				)}
			</div>
			<div className="min-h-0 flex-1 overflow-hidden p-5">
				{line && <p className="line-clamp-2 break-words text-2xl font-extrabold">{line}</p>}
				{face?.tags && (
					<ul className="mt-3 flex flex-wrap gap-1">
						{face.tags.map((tag) => (
							<li key={tag} className="rounded-full px-2 py-1 text-xs" style={{ background: theme.chip }}>
								{tag}
							</li>
						))}
					</ul>
				)}
				{face?.section && (
					<div className="mt-3 text-sm">
						<strong>{face.section.title}</strong>
						<p className="line-clamp-3">{face.section.body}</p>
					</div>
				)}
			</div>
			<div className="flex h-20 shrink-0 items-center gap-3 px-5" style={{ background: theme.footbg }}>
				{actor.avatarUrl ? (
					<img src={actor.avatarUrl} alt="" className="size-11 rounded-full object-cover" />
				) : (
					<span
						className="grid size-11 place-items-center rounded-full font-bold"
						style={{ background: theme.avbg, color: theme.avfg }}
					>
						{[...actor.name][0]}
					</span>
				)}
				<div>
					<strong>{actor.name}</strong>
					{actor.kind === "agent" && <p className="text-xs">Agent · {actor.online ? "在线" : "离线"}</p>}
				</div>
			</div>
		</div>
	);
}
