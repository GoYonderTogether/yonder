import { useEffect, useState } from "react";
import { itemName, useWalletItems } from "../../lib/cardItems";
import { BigCard, CardActions } from "../CardView";

/** 本人、Agent、历史身份卡共用一副牌；点正面翻下一张，操作始终在卡外。 */
export function CardStack({ focus }: { focus?: string }) {
	const items = useWalletItems();
	const [selected, setSelected] = useState(focus ?? items[0].key);
	useEffect(() => {
		if (focus) setSelected(focus);
	}, [focus]);
	const index = Math.max(
		0,
		items.findIndex((i) => i.key === selected || i.card?.code === selected || i.actor.code === selected),
	);
	const current = items[index];
	const next = () => setSelected(items[(index + 1) % items.length].key);
	return (
		<section
			aria-label="我的名片卡叠"
			className="mx-auto flex w-full max-w-[380px] flex-col items-center gap-4 px-4 py-5"
		>
			<div className="flex w-full items-center justify-between gap-3 text-small">
				<h2 className="font-semibold">我的名片</h2>
				<span aria-live="polite" className="text-muted">
					{index + 1} / {items.length}
				</span>
			</div>
			<div className="relative mt-4 aspect-[3/4.3] w-full max-w-[300px]">
				{items.map((item, k) => {
					const position = (k - index + items.length) % items.length;
					return (
						<div
							key={item.key}
							aria-hidden={position !== 0}
							className="absolute inset-0 origin-bottom transition-[transform,opacity] duration-300 motion-reduce:transition-none"
							style={{
								transform: `translateY(${-position * 8}px) rotate(${position * 2}deg) scale(${1 - Math.min(position, 2) * 0.035})`,
								opacity: position < 3 ? 1 : 0,
								transitionTimingFunction: "cubic-bezier(0.34, 1.32, 0.64, 1)",
								zIndex: items.length - position,
								pointerEvents: position === 0 ? "auto" : "none",
							}}
						>
							<BigCard item={item} />
						</div>
					);
				})}
				<button
					type="button"
					onClick={next}
					disabled={items.length < 2}
					aria-label={items.length > 1 ? `当前${itemName(current)}，点击查看下一张名片` : itemName(current)}
					className="absolute inset-0 rounded-[24px] outline-offset-4 focus-visible:outline-2 focus-visible:outline-accent"
					style={{ zIndex: items.length + 1 }}
				/>
			</div>
			<p className="max-w-full truncate text-small font-medium">
				{itemName(current)}
				{current.card?.kind === "persona" ? " · 历史身份卡" : ""}
			</p>
			{items.length > 1 && <p className="text-caption text-muted">点名片翻到下一张</p>}
			<CardActions key={current.key} item={current} row />
		</section>
	);
}
