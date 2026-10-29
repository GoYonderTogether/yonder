import { QrCode, X } from "lucide-react";
import { Dialog } from "radix-ui";
import type { RefObject } from "react";
import { useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { canShareCard, useWalletItems } from "../../lib/cardItems";
import { hasInternalOrigin } from "../../lib/navigation";
import { CardShareDialog } from "../CardShare";
import { BigCard } from "../CardView";
import { CardStack } from "./CardStack";

export { useWalletItems } from "../../lib/cardItems";

/** 通讯录入口保留叠卡；展开后与我/添加朋友共用同一副牌。 */
export function MobileWallet({ scroller: _scroller }: { scroller: RefObject<HTMLDivElement | null> }) {
	const items = useWalletItems();
	const [sp, setSp] = useSearchParams();
	const nav = useNavigate();
	const loc = useLocation();
	const [qr, setQr] = useState(false);
	const wallet = sp.get("wallet");
	const close = () => {
		if (loc.state?.w || hasInternalOrigin(loc.state)) {
			nav(-1);
			return;
		}
		const next = new URLSearchParams(sp);
		next.delete("wallet");
		setSp(next, { replace: true });
	};
	const open = () => {
		const next = new URLSearchParams(sp);
		next.set("wallet", "1");
		setSp(next, { state: { ...loc.state, w: 1 } });
	};
	return (
		<>
			<div className="relative h-[208px] shrink-0 overflow-hidden px-4 pt-5">
				<button
					type="button"
					onClick={open}
					aria-label="展开名片卡包"
					className="relative block h-full w-full overflow-hidden rounded-t-[24px] text-left"
				>
					{items
						.slice(0, 3)
						.reverse()
						.map((item, k, shown) => (
							<div
								key={item.key}
								className="absolute top-0 left-1/2 w-[min(100%,320px)] origin-top"
								style={{
									transform: `translateX(-50%) translateY(${(shown.length - k - 1) * 9}px) rotate(${(shown.length - k - 1) * 2}deg)`,
									zIndex: k,
								}}
							>
								<BigCard item={item} />
							</div>
						))}
					<span className="absolute inset-x-0 bottom-0 z-10 bg-ground/95 px-4 py-3 text-small font-medium">
						我的名片 · {items.length} 张
					</span>
				</button>
				{canShareCard(items[0]) && (
					<button
						type="button"
						aria-label="我的二维码"
						onClick={() => setQr(true)}
						className="press absolute top-6 right-6 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-raised shadow-soft"
					>
						<QrCode size={18} />
					</button>
				)}
			</div>
			<CardShareDialog item={items[0]} open={qr} onOpenChange={setQr} />
			<Dialog.Root open={wallet !== null} onOpenChange={(v) => !v && close()}>
				<Dialog.Portal>
					<Dialog.Overlay className="fade fixed inset-0 z-40 bg-ground" />
					<Dialog.Content
						aria-describedby={undefined}
						className="fade fixed inset-0 z-40 overflow-y-auto bg-ground pt-[env(safe-area-inset-top)] outline-none"
					>
						<header className="flex h-14 items-center px-4">
							<Dialog.Title className="flex-1 text-small font-semibold">我的名片</Dialog.Title>
							<Dialog.Close asChild>
								<button
									type="button"
									aria-label="收起"
									className="press flex h-11 w-11 items-center justify-center rounded-full text-muted"
								>
									<X size={20} />
								</button>
							</Dialog.Close>
						</header>
						<CardStack focus={wallet && wallet !== "1" ? wallet : undefined} />
					</Dialog.Content>
				</Dialog.Portal>
			</Dialog.Root>
		</>
	);
}
