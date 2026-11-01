export type PhotoKind = "avatar" | "cover";
export interface ImageSize {
	width: number;
	height: number;
}
export interface CropPosition {
	x: number;
	y: number;
	zoom: number;
}
export const cropRatio = (kind: PhotoKind) => (kind === "avatar" ? 1 : 3);
export const cropOutput = (kind: PhotoKind) =>
	kind === "avatar" ? { width: 512, height: 512 } : { width: 1600, height: 533 };
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function validatePhotoSource(file: File): void {
	const image = file.type.startsWith("image/") || (!file.type && /\.(jpe?g|png|webp|heic|heif|avif)$/i.test(file.name));
	if (!image || file.size < 1 || file.size > 20 * 1024 * 1024) throw new Error("请选择不超过 20 MB 的照片");
}
export function cropRect(size: ImageSize, ratio: number, position: CropPosition) {
	if (
		!(
			size.width > 0 &&
			size.height > 0 &&
			Number.isFinite(size.width) &&
			Number.isFinite(size.height) &&
			ratio > 0 &&
			Number.isFinite(ratio)
		)
	)
		throw new Error("照片尺寸无效");
	const zoom = clamp(Number.isFinite(position.zoom) ? position.zoom : 1, 1, 5);
	const width = Math.min(size.width, size.height * ratio) / zoom;
	const height = width / ratio;
	const cx = clamp(Number.isFinite(position.x) ? position.x : size.width / 2, width / 2, size.width - width / 2);
	const cy = clamp(Number.isFinite(position.y) ? position.y : size.height / 2, height / 2, size.height - height / 2);
	return { x: cx - width / 2, y: cy - height / 2, width, height, zoom };
}
export function cropPosition(size: ImageSize, ratio: number, position: CropPosition): CropPosition {
	const rect = cropRect(size, ratio, position);
	return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, zoom: rect.zoom };
}
/** Normalized viewport anchors keep the same image point under a drag or pinch. */
export function transformCrop(
	size: ImageSize,
	ratio: number,
	position: CropPosition,
	zoom: number,
	from: { x: number; y: number },
	to = from,
): CropPosition {
	const before = cropRect(size, ratio, position);
	const after = cropRect(size, ratio, { ...position, zoom });
	return cropPosition(size, ratio, {
		zoom: after.zoom,
		x: before.x + from.x * before.width - (to.x - 0.5) * after.width,
		y: before.y + from.y * before.height - (to.y - 0.5) * after.height,
	});
}

export interface DecodedPhoto extends ImageSize {
	source: CanvasImageSource;
	close(): void;
}
export async function decodePhoto(file: File, signal?: AbortSignal): Promise<DecodedPhoto> {
	validatePhotoSource(file);
	if (signal?.aborted) throw new DOMException("已取消", "AbortError");
	if (typeof createImageBitmap === "function") {
		try {
			const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
			if (signal?.aborted) {
				bitmap.close();
				throw new DOMException("已取消", "AbortError");
			}
			if (!bitmap.width || !bitmap.height) {
				bitmap.close();
				throw new Error("empty image");
			}
			return { width: bitmap.width, height: bitmap.height, source: bitmap, close: () => bitmap.close() };
		} catch {
			if (signal?.aborted) throw new DOMException("已取消", "AbortError");
			/* Safari may decode camera HEIC through its native image element instead. */
		}
	}
	const url = URL.createObjectURL(file);
	const image = new Image();
	try {
		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => {
				image.onload = null;
				image.onerror = null;
				signal?.removeEventListener("abort", abort);
				reject(new Error("照片读取超时，请重新选择"));
			}, 20_000);
			const abort = () => {
				clearTimeout(timeout);
				image.onload = null;
				image.onerror = null;
				reject(new DOMException("已取消", "AbortError"));
			};
			signal?.addEventListener("abort", abort, { once: true });
			image.onload = () => {
				clearTimeout(timeout);
				signal?.removeEventListener("abort", abort);
				resolve();
			};
			image.onerror = () => {
				clearTimeout(timeout);
				signal?.removeEventListener("abort", abort);
				reject(new Error("这张照片无法读取，请换一张照片"));
			};
			image.src = url;
		});
		if (!image.naturalWidth || !image.naturalHeight) throw new Error("这张照片无法读取，请换一张照片");
		return {
			width: image.naturalWidth,
			height: image.naturalHeight,
			source: image,
			close: () => {
				image.src = "";
				URL.revokeObjectURL(url);
			},
		};
	} catch (error) {
		image.src = "";
		URL.revokeObjectURL(url);
		throw error;
	}
}

export function drawCrop(
	canvas: HTMLCanvasElement,
	image: DecodedPhoto,
	kind: PhotoKind,
	position: CropPosition,
): void {
	const context = canvas.getContext("2d");
	if (!context) throw new Error("当前浏览器无法处理图片");
	const rect = cropRect(image, cropRatio(kind), position);
	context.fillStyle = "#ffffff";
	context.fillRect(0, 0, canvas.width, canvas.height);
	context.drawImage(image.source, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
}
export async function exportCrop(image: DecodedPhoto, kind: PhotoKind, position: CropPosition): Promise<File> {
	const canvas = document.createElement("canvas");
	Object.assign(canvas, cropOutput(kind));
	try {
		drawCrop(canvas, image, kind, position);
		for (const quality of [0.92, 0.82, 0.7, 0.55]) {
			const blob = await new Promise<Blob>((resolve, reject) => {
				canvas.toBlob(
					(value) => (value ? resolve(value) : reject(new Error("图片处理失败，请重试"))),
					"image/jpeg",
					quality,
				);
			});
			if (!["image/jpeg", "image/png", "image/webp"].includes(blob.type)) throw new Error("图片编码失败，请重试");
			if (blob.size > 0 && blob.size <= 5 * 1024 * 1024) {
				const extension = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
				return new File([blob], `${kind}.${extension}`, { type: blob.type });
			}
		}
		throw new Error("图片处理后仍过大，请换一张照片");
	} finally {
		canvas.width = 0;
		canvas.height = 0;
	}
}
