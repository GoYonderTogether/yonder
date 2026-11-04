import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { isAvatarUrl } from "../../api/avatarUrl";
import type { CardProfile } from "../../api/types";
import { cn } from "../../lib/cn";
import { AvatarImage } from "../../ui/Avatar";

const serif = { fontFamily: "var(--font-display)" } as const;

/** 名片正面左栏的照片：coverUrl 优先，缺了退头像，再退宋体首字。 */
function PaperPhoto({ photoUrl, name }: { photoUrl?: string | null; name: string }) {
	return (
		<span className="relative block overflow-hidden bg-tone-2">
			<AvatarImage url={isAvatarUrl(photoUrl) ? photoUrl : undefined}>
				<span
					aria-hidden
					className="flex h-full w-full items-center justify-center text-[clamp(56px,26cqw,96px)] text-ink/75"
					style={serif}
				>
					{[...name][0]}
				</span>
			</AvatarImage>
		</span>
	);
}

/** 背面 k/v 行 + 「在找」；空段不渲染。 */
function PaperFacts({ profile }: { profile: CardProfile }) {
	const facts = (profile.facts ?? []).filter((f) => f.k.trim() && f.v.trim());
	const seeking = profile.seeking?.trim();
	return (
		<div className="flex min-w-0 flex-col justify-center gap-2.5">
			{facts.map((f) => (
				<div key={f.k} className="grid grid-cols-[4.6em_1fr] gap-2.5 text-small leading-normal">
					<b className="pt-0.5 text-[0.86em] font-medium tracking-wider text-faint">{f.k}</b>
					<span className="break-words">{f.v}</span>
				</div>
			))}
			{seeking && (
				<p className="mt-1 break-words border-t border-dashed border-ink/18 pt-2.5 text-small" style={serif}>
					<span className="mr-1 text-[0.78em] tracking-widest text-brand-blue">在找</span>
					{seeking}
				</p>
			)}
		</div>
	);
}

/**
 * card-demo 原型的纸卡：正面照片 + 宋体名字 + 头衔/一句话/标签/小码，
 * 点按翻到背面 k/v 事实 + 大码。所有字段只在数据存在时渲染。
 */
export function PaperCard({
	name,
	photoUrl,
	brand,
	profile,
	headline,
	tags = [],
	url,
	flippable = true,
	className,
}: {
	name: string;
	/** 正面照片：face.coverUrl，调用方负责回退到头像 */
	photoUrl?: string | null;
	/** 右上角品牌行，只在数据里有时传 */
	brand?: string;
	profile?: CardProfile;
	/** 正面的一行话（tagline / headline） */
	headline?: string;
	tags?: string[];
	/** 真实公开地址，二维码内容 */
	url: string;
	/** 展示卡（如收藏列表缩略图）可以禁用翻面 */
	flippable?: boolean;
	className?: string;
}) {
	const [flipped, setFlipped] = useState(false);
	const title = profile?.title?.trim();
	const alias = profile?.alias?.trim();
	const line = headline?.trim();
	const visibleTags = tags.filter((t) => t.trim());
	const backFacts = !!profile?.facts?.length || !!profile?.seeking?.trim();
	return (
		<div className={cn("paper-stage w-full", className)} style={{ containerType: "inline-size" }}>
			<button
				type="button"
				className="paper-card block cursor-pointer"
				data-flipped={flipped}
				style={{ aspectRatio: "90 / 54" }}
				aria-label={flippable ? `${name}的名片，点按翻面` : `${name}的名片`}
				onClick={() => flippable && setFlipped((f) => !f)}
				disabled={!flippable}
			>
				{/* 正面 */}
				<span className="paper-side paper-side-front grid grid-cols-[34%_1fr] text-left">
					<PaperPhoto photoUrl={photoUrl} name={name} />
					<span className="relative flex min-w-0 flex-col p-[7%_7%_6%]">
						{brand?.trim() && (
							<span className="absolute top-[7%] right-[7%] flex items-center gap-1.5 text-[11px] tracking-[0.12em] text-faint">
								{brand.trim()}
							</span>
						)}
						<span
							className="mt-[2%] truncate text-[clamp(22px,9cqw,42px)] leading-[1.1] tracking-[0.04em] font-semibold"
							style={serif}
						>
							{name}
							{alias && (
								<small
									className="ml-[0.6em] text-[0.36em] font-normal tracking-[0.08em] text-faint"
									style={{ fontFamily: "inherit" }}
								>
									{alias}
								</small>
							)}
						</span>
						{title && <span className="mt-1.5 text-[clamp(11px,3.6cqw,14px)] text-muted">{title}</span>}
						{line && (
							<span className="mt-auto line-clamp-2 text-[clamp(12px,4.4cqw,18px)] leading-[1.55]" style={serif}>
								{line}
							</span>
						)}
						<span className="mt-[6%] flex items-end justify-between gap-3">
							<span className="flex flex-wrap gap-1.5">
								{visibleTags.map((tag) => (
									<span key={tag} className="rounded-full border border-ink/16 px-2 py-0.5 text-[11px] text-muted">
										{tag}
									</span>
								))}
							</span>
							<QRCodeSVG
								value={url}
								size={96}
								marginSize={0}
								className="w-[clamp(40px,13cqw,62px)] flex-none opacity-90"
								style={{ height: "auto" }}
								role="img"
								aria-label={`${name}的二维码`}
							/>
						</span>
					</span>
				</span>
				{/* 背面 */}
				<span className="paper-side paper-side-back grid grid-cols-[1fr_auto] gap-[6%] p-[7%] text-left">
					{backFacts ? (
						<PaperFacts profile={profile!} />
					) : (
						<span className="flex flex-col justify-center gap-2 text-small text-muted">
							<span className="text-[clamp(18px,7cqw,28px)] tracking-[0.04em]" style={serif}>
								{name}
							</span>
							{title && <span className="text-muted">{title}</span>}
						</span>
					)}
					<span className="flex flex-col items-center justify-center gap-2">
						<QRCodeSVG
							value={url}
							size={128}
							marginSize={0}
							className="w-[clamp(72px,22cqw,120px)]"
							style={{ height: "auto" }}
							role="img"
							aria-label="扫码查看资料"
						/>
						<span className="text-center text-[11px] leading-snug text-faint">
							扫码看详情
							<br />
							和我的 AI 聊聊
						</span>
					</span>
				</span>
			</button>
		</div>
	);
}

/** 「详情」展开块：profile.intro，宋体正文。没有内容就不渲染。 */
export function PaperIntro({ profile }: { profile?: CardProfile }) {
	const intro = profile?.intro?.trim();
	if (!intro) return null;
	return (
		<section aria-label="详情" className="flex flex-col gap-2">
			<h2 className="text-caption font-medium tracking-[0.14em] text-faint uppercase">详情</h2>
			<p className="break-words text-body leading-[1.85]" style={serif}>
				{intro}
			</p>
		</section>
	);
}
