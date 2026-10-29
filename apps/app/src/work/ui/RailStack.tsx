import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useRef } from "react";
import {
	getLayout,
	RAIL_MAX,
	RAIL_MIN,
	type RailCard,
	reorderRail,
	setRailPref,
	useLayout,
	useRailPref,
} from "../lib/layout";
import { moveCard, reorderCards, sameOrder } from "../lib/railLayout";
import type { SessionView } from "../lib/useSession";
import { PanelCard } from "./PanelCard";

function SortableCard({ card, session, v }: { card: RailCard; session: string; v: SessionView }) {
	const s = useSortable({ id: card.id });
	// dnd-kit 的键盘拖拽也挂在把手的 onKeyDown 上：先让它处理，空格/回车照常进入拖拽。
	const dragKeyDown = s.listeners?.onKeyDown as ((e: React.KeyboardEvent) => void) | undefined;
	// 键盘换位：Alt+↑/↓ 直接把卡片上下挪一格并立即持久化，不必先按空格进入拖拽。
	const onKeyDown = (e: React.KeyboardEvent) => {
		dragKeyDown?.(e);
		if (s.isDragging) return;
		if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
		e.preventDefault();
		const ids = getLayout(session).rail.map((c) => c.id);
		const next = moveCard(ids, card.id, e.key === "ArrowUp" ? -1 : 1);
		if (!sameOrder(ids, next)) reorderRail(session, next);
	};
	return (
		<div
			ref={s.setNodeRef}
			style={{
				transform: CSS.Transform.toString(s.transform),
				transition: s.transition,
				opacity: s.isDragging ? 0.6 : 1,
			}}
		>
			<PanelCard
				placement="rail"
				session={session}
				v={v}
				cardId={card.id}
				tabs={card.tabs}
				active={card.active}
				handleRef={s.setActivatorNodeRef}
				handleProps={{ ...s.attributes, ...s.listeners, onKeyDown }}
			/>
		</div>
	);
}

/** 卡片栈：dnd-kit 上下拖拽重排，顺序按会话持久化。窄屏全屏抽屉里也用它。 */
export function CardStack({ session, v }: { session: string; v: SessionView }) {
	const layout = useLayout(session);
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
	);
	const ids = layout.rail.map((c) => c.id);
	const end = (e: DragEndEvent) => {
		const next = reorderCards(ids, String(e.active.id), e.over ? String(e.over.id) : "");
		if (!sameOrder(ids, next)) reorderRail(session, next);
	};
	return (
		<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={end}>
			<SortableContext items={ids} strategy={verticalListSortingStrategy}>
				<div className="scroll-y flex h-full flex-col gap-2 p-2" data-testid="rail">
					{layout.rail.length === 0 && (
						<p className="px-2 py-6 text-center text-caption text-faint">
							卡片都弹出成悬浮窗了。在悬浮窗上点「停靠到右栏」放回来。
						</p>
					)}
					{layout.rail.map((c) => (
						<SortableCard key={c.id} card={c} session={session} v={v} />
					))}
				</div>
			</SortableContext>
		</DndContext>
	);
}

/** 桌面右栏：左缘拖拽调宽（键盘 ←/→ 也可），宽度进 localStorage。 */
export function RightRail({ session, v }: { session: string; v: SessionView }) {
	const pref = useRailPref();
	const drag = useRef<{ x: number; w: number } | null>(null);
	if (!pref.open) return null;
	return (
		<aside
			className="relative shrink-0 border-l border-hairline bg-list"
			style={{ width: pref.width }}
			aria-label="右栏"
			data-testid="right-rail"
		>
			{/* biome-ignore lint/a11y/useSemanticElements: 可聚焦的拖拽分隔条，<hr> 不能承载交互 */}
			<div
				role="separator"
				aria-orientation="vertical"
				aria-label="调整右栏宽度"
				aria-valuemin={RAIL_MIN}
				aria-valuemax={RAIL_MAX}
				aria-valuenow={pref.width}
				tabIndex={0}
				className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none hover:bg-tone-2/60"
				data-testid="rail-resize"
				onPointerDown={(e) => {
					e.currentTarget.setPointerCapture(e.pointerId);
					drag.current = { x: e.clientX, w: pref.width };
				}}
				onPointerMove={(e) => {
					if (drag.current) setRailPref({ width: drag.current.w + (drag.current.x - e.clientX) });
				}}
				onPointerUp={() => {
					drag.current = null;
				}}
				onKeyDown={(e) => {
					if (e.key === "ArrowLeft") setRailPref({ width: pref.width + 16 });
					if (e.key === "ArrowRight") setRailPref({ width: pref.width - 16 });
				}}
			/>
			<CardStack session={session} v={v} />
		</aside>
	);
}
