import type { CSSProperties } from "react";
import type { Actor, Card } from "../../../api/social";
import { Logo } from "../../../ui/kit/Logo";
import { isAvatarUrl } from "../lib/avatar";
import { THEMES } from "./themes";

const u = (n: number) => `${n}cqw`;

function FaceAvatar({ actor, size, theme }: { actor: Actor; size: string; theme: { avbg: string; avfg: string } }) {
	const agent = actor.kind === "agent";
	return (
		<span
			className="flex shrink-0 items-center justify-center overflow-hidden font-bold"
			style={{
				width: size,
				height: size,
				fontSize: u(5.5),
				borderRadius: agent ? u(4) : "50%",
				background: agent ? "#111111" : theme.avbg,
				color: agent ? "#ffffff" : theme.avfg,
			}}
		>
			{actor.avatarUrl && isAvatarUrl(actor.avatarUrl) ? (
				<img src={actor.avatarUrl} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
			) : agent ? (
				<Logo size={22} radius={0.32} />
			) : (
				[...actor.name][0]
			)}
		</span>
	);
}

/**
 * 竖版名片（3:4.3）：封面 / 一句话 / 标签 / 一个小节 / 底栏。
 * 与名片站 components/card/CardFace 同一份尺寸：所有尺寸按卡宽的 cqw 缩放，缩略图与大卡共用。
 */
export function CardFaceView({ actor, card }: { actor: Actor; card?: Card }) {
	const face = card?.face;
	const t = THEMES[face?.theme ?? "mist"];
	const line = face?.headline?.trim() || card?.tagline?.trim() || card?.summary?.trim() || "";
	const tags = face?.tags ?? [];
	const section = face?.section;
	const sticker = face?.sticker;
	const bare = !line && !tags.length && !section;
	const style: CSSProperties = {
		containerType: "inline-size",
		aspectRatio: "3 / 4.3",
		borderRadius: "8% / 5.58%",
		background: t.bg,
		color: t.fg,
	};
	const frame: CSSProperties =
		sticker?.frame === "stamp"
			? {
					outline: `${u(0.9)} solid ${t.bg}`,
					outlineOffset: u(1.8),
					boxShadow: `0 0 0 ${u(2.6)} ${t.edge}`,
					borderRadius: u(1.8),
				}
			: sticker?.frame === "round"
				? { borderRadius: u(5) }
				: {};
	return (
		<div style={style} className="relative flex w-full flex-col overflow-hidden shadow-soft">
			<div
				className="relative grid place-items-center overflow-hidden"
				style={{
					height: bare && !card?.display && !sticker?.url ? "100%" : "42%",
					flexShrink: 1,
					background: `linear-gradient(${t.from}, ${t.to})`,
				}}
			>
				{card?.display ? (
					<iframe
						title="展示卡片"
						sandbox=""
						srcDoc={
							card.display.kind === "svg"
								? `<style>html,body{margin:0;height:100%}svg{display:block;width:100%;height:100%}</style>${card.display.source}`
								: card.display.source
						}
						className="pointer-events-none h-full w-full border-0"
					/>
				) : sticker?.url ? (
					<img
						src={sticker.url}
						alt=""
						style={{ width: "58%", aspectRatio: "4 / 3", objectFit: "cover", background: t.stickerbg, ...frame }}
					/>
				) : bare ? (
					<span className="max-w-[80%] truncate text-center font-extrabold" style={{ fontSize: u(9) }}>
						{actor.name}
					</span>
				) : null}
			</div>
			<div
				className={`min-h-0 flex-1 flex-col overflow-hidden ${bare ? "hidden" : "flex"}`}
				style={{ padding: `${u(5)} ${u(6.5)} 0`, gap: u(3.5) }}
			>
				{line && (
					<p
						className="line-clamp-2 break-words font-extrabold"
						style={{ fontSize: u(8.6), lineHeight: 1.15, letterSpacing: "-0.02em" }}
					>
						{line}
					</p>
				)}
				{!!tags.length && (
					<div className="flex flex-wrap" style={{ gap: u(1.8) }}>
						{tags.map((tag) => (
							<span
								key={tag}
								className="rounded-full"
								style={{ padding: `${u(1.4)} ${u(3.2)}`, fontSize: u(3.7), background: t.chip }}
							>
								{tag}
							</span>
						))}
					</div>
				)}
				{section && (
					<div style={{ fontSize: u(3.8), lineHeight: 1.5, opacity: 0.85 }}>
						<b className="block font-semibold" style={{ fontSize: u(3.3), opacity: 0.7 }}>
							{section.title}
						</b>
						<span className="line-clamp-3">{section.body}</span>
					</div>
				)}
			</div>
			<div
				className="flex shrink-0 items-center"
				style={{ height: u(24), gap: u(3.5), padding: `0 ${u(5)}`, background: t.footbg }}
			>
				<FaceAvatar actor={actor} size={u(14)} theme={t} />
				<span className="min-w-0 flex-1">
					<span className="block truncate font-bold" style={{ fontSize: u(4.6) }}>
						{actor.name}
					</span>
					{(actor.kind === "agent" || actor.online !== undefined) && (
						<span
							className="flex items-center opacity-70"
							style={{ fontSize: u(3.4), gap: u(1.6) }}
						>
							{actor.kind === "agent" && "Agent"}
							{actor.kind === "agent" && (
								<>
									<i
										className={actor.online ? "bg-online" : "bg-offline"}
										style={{ width: u(2), height: u(2), borderRadius: "50%" }}
									/>
									{actor.online ? "在线" : "离线"}
								</>
							)}
						</span>
					)}
				</span>
			</div>
		</div>
	);
}
