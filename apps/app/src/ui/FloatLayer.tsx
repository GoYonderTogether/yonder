import { PanelTop } from "lucide-react";
import { useRef } from "react";
import { type FloatCard, PANEL_TITLE, patchFloat, useLayout } from "../lib/layout";
import { clampFloatPosition } from "../lib/railLayout";
import type { SessionView } from "../lib/useSession";
import { PanelCard } from "./PanelCard";

function Floating({ f, session, v }: { f: FloatCard; session: string; v: SessionView }) {
	const start = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
	const handleProps = {
		onPointerDown(e: React.PointerEvent) {
			e.currentTarget.setPointerCapture(e.pointerId);
			start.current = { px: e.clientX, py: e.clientY, x: f.x, y: f.y };
		},
		onPointerMove(e: React.PointerEvent) {
			const s = start.current;
			if (!s) return;
			const host = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-float-host]");
			const box = host?.getBoundingClientRect();
			const { x, y } = clampFloatPosition(
				s.x + e.clientX - s.px,
				s.y + e.clientY - s.py,
				box ? { width: box.width, height: box.height } : undefined,
			);
			patchFloat(session, f.id, { x, y });
		},
		onPointerUp() {
			start.current = null;
		},
		onPointerCancel() {
			start.current = null;
		},
	};
	// 收起：缩成角标（保留位置，点开恢复）
	if (f.collapsed)
		return (
			<button
				type="button"
				onClick={() => patchFloat(session, f.id, { collapsed: false })}
				{...handleProps}
				style={{ left: f.x, top: f.y }}
				className="pointer-events-auto absolute flex cursor-grab touch-none items-center gap-1.5 rounded-full bg-raised px-3 py-1.5 text-caption shadow-float"
				data-testid="float-badge"
				aria-label={`展开${PANEL_TITLE[f.kind]}`}
			>
				<PanelTop size={14} aria-hidden /> {PANEL_TITLE[f.kind]}
			</button>
		);
	return (
		<div className="pointer-events-auto absolute" style={{ left: f.x, top: f.y }}>
			<PanelCard
				placement="floating"
				session={session}
				v={v}
				cardId={f.id}
				tabs={[f.kind]}
				active={f.kind}
				collapsed={f.collapsed}
				onToggleCollapse={() => patchFloat(session, f.id, { collapsed: true })}
				handleProps={handleProps}
			/>
		</div>
	);
}

/** 叠在主区域上的悬浮窗层；层本身不拦截点击。 */
export function FloatLayer({ session, v }: { session: string; v: SessionView }) {
	const layout = useLayout(session);
	if (layout.float.length === 0) return null;
	return (
		<div
			className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
			data-float-host
			data-testid="float-layer"
		>
			{layout.float.map((f) => (
				<Floating key={f.id} f={f} session={session} v={v} />
			))}
		</div>
	);
}
