import { adventurer, bigSmile, lorelei, notionists, thumbs, toonHead } from "@dicebear/collection";
import { createAvatar, type Style } from "@dicebear/core";
import { useMemo, useState } from "react";
import { cn } from "../lib/cn";
import { Button } from "../ui/Button";

/**
 * 头像选择器：DiceBear 本地生成（MIT，无网络请求），按风格分组。
 * 「小动物」用 thumbs（圆润的小生物脸），「卡通」用三套人像风格。
 * 同一个组件之后可直接给用户自己的头像用；写实头像（预设图片 URL）
 * 留待资源就绪后在 TABS 里加一项，不放空占位。
 */

// 各风格的 Options 互不兼容，收集进同一数组必须放宽到统一 Style 类型；
// 只传 seed/size，选项都是各自的默认值，类型参数不影响运行行为。
type AnyDiceBearStyle = Style<Record<string, unknown>>;

const STYLE_GROUPS: { key: string; label: string; styles: { id: string; style: AnyDiceBearStyle }[] }[] = [
	{
		key: "creature",
		label: "小动物",
		styles: [
			{ id: "thumbs", style: thumbs },
			{ id: "toon-head", style: toonHead },
		],
	},
	{
		key: "cartoon",
		label: "卡通",
		styles: [
			{ id: "adventurer", style: adventurer },
			{ id: "notionists", style: notionists },
			{ id: "lorelei", style: lorelei },
			{ id: "big-smile", style: bigSmile },
		],
	},
];

const SEEDS_PER_PAGE = 12;

const avatarUri = (style: AnyDiceBearStyle, seed: string) => createAvatar(style, { seed, size: 96 }).toDataUri();

export function AvatarPicker({
	value,
	onChange,
	className,
}: {
	value: { style: string; seed: string } | null;
	onChange: (next: { style: string; seed: string }) => void;
	className?: string;
}) {
	const [groupKey, setGroupKey] = useState<string>(STYLE_GROUPS[0].key);
	const group = STYLE_GROUPS.find((g) => g.key === groupKey) ?? STYLE_GROUPS[0];
	const [styleId, setStyleId] = useState<string>(group.styles[0].id);
	const activeStyle = group.styles.find((s) => s.id === styleId) ?? group.styles[0];
	const [round, setRound] = useState(0);
	const seeds = useMemo(
		() => Array.from({ length: SEEDS_PER_PAGE }, (_, i) => `${groupKey}-${styleId}-${round}-${i}`),
		[groupKey, styleId, round],
	);
	const selected = value?.style === activeStyle.id ? value.seed : null;
	return (
		<div className={cn("flex flex-col gap-3", className)}>
			<div role="tablist" aria-label="头像风格" className="flex gap-1 rounded-control bg-tone p-1">
				{STYLE_GROUPS.map((g) => (
					<button
						key={g.key}
						type="button"
						role="tab"
						aria-selected={g.key === group.key}
						className={cn(
							"press min-h-9 flex-1 rounded-control text-small",
							g.key === group.key ? "bg-raised font-medium shadow-soft" : "text-muted",
						)}
						onClick={() => {
							setGroupKey(g.key);
							setStyleId(g.styles[0].id);
						}}
					>
						{g.label}
					</button>
				))}
			</div>
			<fieldset className="grid grid-cols-4 gap-2 border-0 p-0">
				{seeds.map((seed) => (
					<button
						key={seed}
						type="button"
						aria-pressed={seed === selected}
						aria-label={`头像 ${seed}`}
						className={cn(
							"press overflow-hidden rounded-control ring-1 ring-hairline",
							seed === selected && "ring-2 ring-accent",
						)}
						onClick={() => onChange({ style: activeStyle.id, seed })}
					>
						<img src={avatarUri(activeStyle.style, seed)} alt="" className="h-full w-full" />
					</button>
				))}
			</fieldset>
			<Button variant="ghost" size="sm" className="self-center" onClick={() => setRound((r) => r + 1)}>
				换一批
			</Button>
		</div>
	);
}

/** 选中项 → 头像 data URI；未选过返回 undefined。 */
export function pickedAvatarUri(picked: { style: string; seed: string } | null | undefined): string | undefined {
	if (!picked) return undefined;
	for (const group of STYLE_GROUPS) {
		const style = group.styles.find((s) => s.id === picked.style);
		if (style) return avatarUri(style.style, picked.seed);
	}
	return undefined;
}
