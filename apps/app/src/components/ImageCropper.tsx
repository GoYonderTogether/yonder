import { Dialog } from "radix-ui";
import { type PointerEvent, useEffect, useId, useRef, useState } from "react";
import {
	type CropPosition,
	cropPosition,
	cropRatio,
	type DecodedPhoto,
	decodePhoto,
	drawCrop,
	exportCrop,
	type PhotoKind,
	transformCrop,
} from "../lib/photoCrop";
import { Button } from "../ui/Button";

type Point = { x: number; y: number };
export function ImageCropper({
	file,
	kind,
	onCancel,
	onComplete,
}: {
	file: File;
	kind: PhotoKind;
	onCancel(): void;
	onComplete(file: File): void;
}) {
	const [image, setImage] = useState<DecodedPhoto>();
	const [position, setPosition] = useState<CropPosition>({ x: 0, y: 0, zoom: 1 });
	const [error, setError] = useState<string>();
	const [busy, setBusy] = useState(false);
	const processing = useRef(false);
	const alive = useRef(true);
	const canvas = useRef<HTMLCanvasElement>(null);
	const pointers = useRef(new Map<number, Point>());
	const label = useId();
	useEffect(() => {
		let active = true;
		let decoded: DecodedPhoto | undefined;
		const controller = new AbortController();
		alive.current = true;
		decodePhoto(file, controller.signal)
			.then((value) => {
				if (!active) {
					value.close();
					return;
				}
				decoded = value;
				setImage(value);
				setPosition({ x: value.width / 2, y: value.height / 2, zoom: 1 });
			})
			.catch((failure) => active && setError(failure instanceof Error ? failure.message : "照片无法读取"));
		return () => {
			active = false;
			alive.current = false;
			controller.abort();
			decoded?.close();
		};
	}, [file]);
	useEffect(() => {
		if (!image || !canvas.current) return;
		try {
			drawCrop(canvas.current, image, kind, position);
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : "照片无法预览");
		}
	}, [image, kind, position]);
	const point = (event: PointerEvent<HTMLButtonElement>) => {
		const rect = event.currentTarget.getBoundingClientRect();
		return { x: (event.clientX - rect.left) / (rect.width || 1), y: (event.clientY - rect.top) / (rect.height || 1) };
	};
	const move = (event: PointerEvent<HTMLButtonElement>) => {
		if (!image || busy || !pointers.current.has(event.pointerId)) return;
		event.preventDefault();
		const before = [...pointers.current.values()];
		pointers.current.set(event.pointerId, point(event));
		const after = [...pointers.current.values()];
		const center = (items: Point[]) => ({
			x: items.reduce((sum, p) => sum + p.x, 0) / items.length,
			y: items.reduce((sum, p) => sum + p.y, 0) / items.length,
		});
		const distance = (items: Point[]) =>
			items.length > 1 ? Math.hypot(items[0].x - items[1].x, (items[0].y - items[1].y) / cropRatio(kind)) : 0;
		setPosition((old) =>
			transformCrop(
				image,
				cropRatio(kind),
				old,
				before.length > 1 && distance(before) > 0.001 ? (old.zoom * distance(after)) / distance(before) : old.zoom,
				center(before),
				center(after),
			),
		);
	};
	const done = async () => {
		if (!image || processing.current) return;
		processing.current = true;
		setBusy(true);
		setError(undefined);
		try {
			const result = await exportCrop(image, kind, position);
			if (alive.current) onComplete(result);
		} catch (failure) {
			if (alive.current) setError(failure instanceof Error ? failure.message : "图片处理失败，请重试");
		} finally {
			processing.current = false;
			if (alive.current) setBusy(false);
		}
	};
	return (
		<Dialog.Root
			open
			onOpenChange={(open) => {
				if (!open && !busy) onCancel();
			}}
		>
			<Dialog.Portal>
				<Dialog.Overlay className="fixed inset-0 z-50 bg-ink/30" />
				<Dialog.Content
					aria-describedby={label}
					className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-ground outline-none md:inset-auto md:top-1/2 md:left-1/2 md:max-h-[90dvh] md:w-[min(720px,calc(100%-2rem))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-panel md:shadow-float"
				>
					<header className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
						<Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
							取消
						</Button>
						<Dialog.Title className="font-semibold">{kind === "avatar" ? "裁切头像" : "裁切背景"}</Dialog.Title>
						<Button type="button" variant="primary" disabled={!image || busy} onClick={() => void done()}>
							{busy ? "处理中…" : "完成"}
						</Button>
					</header>
					<div className="flex min-h-0 flex-1 items-center justify-center px-5 py-6">
						{image ? (
							<button
								type="button"
								disabled={busy}
								aria-label="裁切区域，拖动或使用方向键调整照片"
								aria-describedby={label}
								className={`relative block touch-none overflow-hidden bg-tone p-0 outline-none focus-visible:ring-2 focus-visible:ring-accent ${kind === "avatar" ? "max-w-[360px] rounded-full" : "w-full max-w-[640px] rounded-control"}`}
								style={{ aspectRatio: cropRatio(kind), width: kind === "avatar" ? "min(100%, 52dvh)" : "100%" }}
								onPointerDown={(event) => {
									if (pointers.current.size >= 2) return;
									event.preventDefault();
									event.currentTarget.setPointerCapture?.(event.pointerId);
									pointers.current.set(event.pointerId, point(event));
								}}
								onPointerMove={move}
								onPointerUp={(event) => pointers.current.delete(event.pointerId)}
								onPointerCancel={(event) => pointers.current.delete(event.pointerId)}
								onLostPointerCapture={(event) => pointers.current.delete(event.pointerId)}
								onKeyDown={(event) => {
									const delta: Record<string, Point> = {
										ArrowLeft: { x: -0.025, y: 0 },
										ArrowRight: { x: 0.025, y: 0 },
										ArrowUp: { x: 0, y: -0.025 },
										ArrowDown: { x: 0, y: 0.025 },
									};
									const next = delta[event.key];
									if (!next) return;
									event.preventDefault();
									setPosition((old) =>
										transformCrop(
											image,
											cropRatio(kind),
											old,
											old.zoom,
											{ x: 0.5, y: 0.5 },
											{ x: 0.5 + next.x, y: 0.5 + next.y },
										),
									);
								}}
							>
								<canvas
									ref={canvas}
									aria-hidden
									width={kind === "avatar" ? 512 : 800}
									height={kind === "avatar" ? 512 : 267}
									className="block h-full w-full"
								/>
							</button>
						) : (
							<p role="status" className="py-12 text-small text-muted">
								{error ? "照片读取失败" : "正在读取照片…"}
							</p>
						)}
					</div>
					<div className="mx-auto flex w-full max-w-md shrink-0 flex-col gap-3 px-6 pt-2 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
						<p id={label} className="text-center text-caption text-muted">
							拖动调整位置，双指或滑动放大
						</p>
						<label className="flex items-center gap-3 text-small text-muted">
							<span>放大</span>
							<input
								type="range"
								aria-label="照片缩放"
								min={1}
								max={5}
								step={0.01}
								value={position.zoom}
								disabled={!image || busy}
								onChange={(event) =>
									image &&
									setPosition((old) =>
										cropPosition(image, cropRatio(kind), { ...old, zoom: Number(event.target.value) }),
									)
								}
								className="h-8 min-w-0 flex-1 accent-accent"
							/>
						</label>
						{error && (
							<p role="alert" className="text-small text-danger">
								{error}
							</p>
						)}
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
