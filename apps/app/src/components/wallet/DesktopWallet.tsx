import { faceProps, itemName } from "../../lib/cardItems";
import { cn } from "../../lib/cn";
import { CardFaceView } from "../card/CardFace";
import { CardStack } from "./CardStack";
import { useWalletItems } from "./Wallet";

/** 桌面列表栏顶部的卡包条：我的名片叠成一摞的小缩略。 */
export function WalletStrip({ active, onClick }: { active: boolean; onClick: () => void }) {
	const items = useWalletItems();
	const shown = items.slice(0, 3);
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label="我的名片"
			className={cn(
				"press mx-2 mb-2 flex h-[120px] shrink-0 items-center gap-4 rounded-card px-4 text-left hover:bg-tone/60",
				active && "bg-raised shadow-soft hover:bg-raised",
			)}
		>
			<span className="relative h-24 shrink-0" style={{ width: 72 + (shown.length - 1) * 20 }}>
				{shown.map((item, k) => (
					<span
						key={item.key}
						className="absolute overflow-hidden rounded-[8px] shadow-soft"
						style={{ left: k * 20, width: 72, top: k * 3, zIndex: shown.length - k, opacity: 1 - k * 0.12 }}
					>
						<CardFaceView {...faceProps(item)} />
					</span>
				))}
			</span>
			<span className="min-w-0 flex-1">
				<span className="block truncate text-small font-medium">我的名片</span>
				<span className="block text-caption text-muted">{items.length} 张</span>
			</span>
		</button>
	);
}

/** 桌面与手机、我的页面、添加朋友共用同一副牌。 */
export function WalletBoard({ focus }: { focus?: string }) {
	return (
		<div className="scroll-y h-full">
			<CardStack focus={focus} />
		</div>
	);
}
