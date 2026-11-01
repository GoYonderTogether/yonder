import { Camera, Image } from "lucide-react";
import { Dialog } from "radix-ui";
import { type Ref, useImperativeHandle, useRef, useState } from "react";
import { type PhotoKind, validatePhotoSource } from "../lib/photoCrop";
import { Button } from "../ui/Button";
import { ImageCropper } from "./ImageCropper";

export interface PhotoPickerHandle {
	open(kind: PhotoKind): void;
}
/** Native image access only follows the user's gallery/camera click. No upload happens here. */
export function PhotoPicker({
	ref,
	disabled,
	onApply,
	onError,
}: {
	ref?: Ref<PhotoPickerHandle>;
	disabled?: boolean;
	onApply(kind: PhotoKind, file: File): void;
	onError(message: string): void;
}) {
	const gallery = useRef<HTMLInputElement>(null);
	const camera = useRef<HTMLInputElement>(null);
	const target = useRef<PhotoKind>("avatar");
	const [kind, setKind] = useState<PhotoKind>("avatar");
	const [sheet, setSheet] = useState(false);
	const [crop, setCrop] = useState<{ kind: PhotoKind; file: File }>();
	useImperativeHandle(
		ref,
		() => ({
			open(next) {
				if (disabled) return;
				target.current = next;
				setKind(next);
				if (typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches) setSheet(true);
				else gallery.current?.click();
			},
		}),
		[disabled],
	);
	const selected = (file?: File) => {
		if (!file || disabled) return;
		try {
			validatePhotoSource(file);
			setCrop({ kind: target.current, file });
		} catch (error) {
			onError(error instanceof Error ? error.message : "这张照片无法使用");
		}
	};
	const openNative = (source: "gallery" | "camera") => {
		setSheet(false);
		(source === "gallery" ? gallery : camera).current?.click();
	};
	return (
		<>
			<input
				ref={gallery}
				hidden
				type="file"
				aria-label="从相册选择照片"
				accept="image/*"
				disabled={disabled}
				onChange={(event) => {
					selected(event.target.files?.[0]);
					event.currentTarget.value = "";
				}}
			/>
			<input
				ref={camera}
				hidden
				type="file"
				aria-label="拍摄照片"
				accept="image/*"
				capture={kind === "avatar" ? "user" : "environment"}
				disabled={disabled}
				onChange={(event) => {
					selected(event.target.files?.[0]);
					event.currentTarget.value = "";
				}}
			/>
			<Dialog.Root open={sheet} onOpenChange={setSheet}>
				<Dialog.Portal>
					<Dialog.Overlay className="fixed inset-0 z-50 bg-ink/30" />
					<Dialog.Content
						aria-describedby={undefined}
						className="fixed inset-x-0 bottom-0 z-50 rounded-t-panel bg-raised p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-float outline-none md:inset-auto md:top-1/2 md:left-1/2 md:w-80 md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-panel"
					>
						<Dialog.Title className="mb-3 text-small font-medium text-muted">
							{kind === "avatar" ? "更换头像" : "更换背景"}
						</Dialog.Title>
						<button
							type="button"
							onClick={() => openNative("gallery")}
							className="press flex min-h-14 w-full items-center gap-3 rounded-control px-3 text-left hover:bg-tone"
						>
							<Image size={20} className="text-accent-ink" />
							相册
						</button>
						<button
							type="button"
							onClick={() => openNative("camera")}
							className="press flex min-h-14 w-full items-center gap-3 rounded-control px-3 text-left hover:bg-tone"
						>
							<Camera size={20} className="text-accent-ink" />
							拍照
						</button>
						<Button type="button" className="mt-3 w-full" onClick={() => setSheet(false)}>
							取消
						</Button>
					</Dialog.Content>
				</Dialog.Portal>
			</Dialog.Root>
			{crop && (
				<ImageCropper
					file={crop.file}
					kind={crop.kind}
					onCancel={() => setCrop(undefined)}
					onComplete={(file) => {
						onApply(crop.kind, file);
						setCrop(undefined);
					}}
				/>
			)}
		</>
	);
}
