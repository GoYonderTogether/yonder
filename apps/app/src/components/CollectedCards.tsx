import { ChevronRight } from "lucide-react";
import { Link, useLocation } from "react-router";
import { useCardItems } from "../lib/cardItems";
import { entityRef } from "../lib/entityRef";
import { internalState } from "../lib/navigation";
import { Avatar } from "../ui/Avatar";

/** 「我」里的收藏列表：名片页点「收藏」或开始聊天时收下的名片（GET /api/cards 里 mine=false 的项）。 */
export function CollectedCards() {
	const loc = useLocation();
	const { received, isLoading } = useCardItems();
	return (
		<section aria-label="收藏的名片" className="overflow-hidden rounded-card bg-raised">
			<div className="flex items-center justify-between px-5 pt-4 pb-2">
				<h2 className="text-small font-medium text-muted">收藏的名片</h2>
				<span className="text-caption text-muted">{received.length} 张</span>
			</div>
			{!isLoading && !received.length && (
				<p className="px-5 pb-4 text-small text-muted">还没有收藏。打开别人的名片，点「收藏」就会出现在这里。</p>
			)}
			<div className="divide-y divide-hairline">
				{received.map((i) => (
					<Link
						key={i.key}
						to={`/u/${i.card ? entityRef(i.card) : i.key}`}
						state={internalState(loc)}
						className="press flex items-center gap-3 px-5 py-4 hover:bg-tone/60"
					>
						<Avatar actor={i.actor} size={44} />
						<div className="min-w-0 flex-1">
							<p className="truncate font-medium">{i.card?.title || i.actor.name}</p>
							{(i.card?.tagline ?? i.card?.summary) && (
								<p className="mt-1 line-clamp-1 text-small text-muted">{i.card?.tagline ?? i.card?.summary}</p>
							)}
						</div>
						<ChevronRight size={16} className="text-muted" />
					</Link>
				))}
			</div>
		</section>
	);
}
