import { afterEach, expect, it, vi } from "vitest";
import {
	cropOutput,
	cropPosition,
	cropRatio,
	cropRect,
	decodePhoto,
	drawCrop,
	exportCrop,
	transformCrop,
	validatePhotoSource,
} from "../src/lib/photoCrop";

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
it("bounds every crop to real pixels for portrait, landscape and extreme drags/zooms", () => {
	for (const image of [
		{ width: 4000, height: 3000 },
		{ width: 3000, height: 5000 },
		{ width: 100, height: 100 },
	]) {
		for (const kind of ["avatar", "cover"] as const)
			for (const zoom of [0.1, 1, 2, 5, 9])
				for (const delta of [-1e6, 0, 1e6]) {
					const rect = cropRect(image, cropRatio(kind), { x: delta, y: -delta, zoom });
					expect(rect.x).toBeGreaterThanOrEqual(0);
					expect(rect.y).toBeGreaterThanOrEqual(0);
					expect(rect.x + rect.width).toBeLessThanOrEqual(image.width + 1e-7);
					expect(rect.y + rect.height).toBeLessThanOrEqual(image.height + 1e-7);
					expect(rect.width / rect.height).toBeCloseTo(cropRatio(kind));
				}
	}
	expect(() => cropRect({ width: 0, height: 200 }, 1, { x: 0, y: 0, zoom: 1 })).toThrow();
});
it("keeps the touched image point stable while zooming and moves against a drag", () => {
	const image = { width: 4000, height: 3000 };
	const old = { x: 2000, y: 1500, zoom: 2 };
	const before = cropRect(image, 1, old);
	const next = transformCrop(image, 1, old, 3, { x: 0.6, y: 0.4 });
	const after = cropRect(image, 1, next);
	expect(before.x + before.width * 0.6).toBeCloseTo(after.x + after.width * 0.6);
	expect(before.y + before.height * 0.4).toBeCloseTo(after.y + after.height * 0.4);
	expect(transformCrop(image, 1, old, 2, { x: 0.5, y: 0.5 }, { x: 0.6, y: 0.5 }).x).toBeLessThan(old.x);
	expect(cropPosition(image, 1, { x: -999, y: 999999, zoom: 50 }).zoom).toBe(5);
});
it("accepts source photos above the upload limit and rejects empty/non-image/oversized sources", () => {
	const source = new File([new Uint8Array(6 * 1024 * 1024)], "camera.heic", { type: "image/heic" });
	expect(() => validatePhotoSource(source)).not.toThrow();
	for (const file of [
		new File([], "empty.jpg", { type: "image/jpeg" }),
		new File(["text"], "file.txt", { type: "text/plain" }),
		new File([new Uint8Array(21 * 1024 * 1024)], "large.jpg", { type: "image/jpeg" }),
	])
		expect(() => validatePhotoSource(file)).toThrow();
});
it("decodes orientation natively and closes a late bitmap when cancelled", async () => {
	const close = vi.fn();
	const bitmap = { width: 800, height: 1200, close };
	const decode = vi.fn().mockResolvedValue(bitmap);
	vi.stubGlobal("createImageBitmap", decode);
	const file = new File(["photo"], "photo.jpg", { type: "image/jpeg" });
	const image = await decodePhoto(file);
	expect(decode).toHaveBeenCalledWith(file, { imageOrientation: "from-image" });
	expect(image.height).toBe(1200);
	image.close();
	expect(close).toHaveBeenCalledOnce();
	let finish!: (value: typeof bitmap) => void;
	decode.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const controller = new AbortController();
	const pending = decodePhoto(file, controller.signal);
	controller.abort();
	finish(bitmap);
	await expect(pending).rejects.toMatchObject({ name: "AbortError" });
	expect(close).toHaveBeenCalledTimes(2);
});
it("revokes fallback object URLs on decode failure or cancellation", async () => {
	vi.stubGlobal("createImageBitmap", undefined);
	vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:decode");
	const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
	vi.stubGlobal(
		"Image",
		class {
			onload?: () => void;
			onerror?: () => void;
			set src(value: string) {
				if (value) queueMicrotask(() => this.onerror?.());
			}
		},
	);
	await expect(decodePhoto(new File(["bad"], "photo.jpg", { type: "image/jpeg" }))).rejects.toThrow("无法读取");
	expect(revoke).toHaveBeenCalledWith("blob:decode");
	vi.stubGlobal(
		"Image",
		class {
			onload?: () => void;
			onerror?: () => void;
			src = "";
		},
	);
	const controller = new AbortController();
	const pending = decodePhoto(new File(["pending"], "photo.jpg", { type: "image/jpeg" }), controller.signal);
	controller.abort();
	await expect(pending).rejects.toMatchObject({ name: "AbortError" });
	expect(revoke).toHaveBeenCalledTimes(2);
});
it("exports exact avatar/cover sizes, compresses to the upload limit, and releases the output canvas", async () => {
	const draw = vi.fn();
	const canvas = {
		width: 0,
		height: 0,
		getContext: () => ({ fillRect() {}, drawImage: draw, fillStyle: "" }),
		toBlob: vi.fn((callback: (blob: Blob) => void) => callback(new Blob(["jpeg"], { type: "image/jpeg" }))),
	};
	vi.stubGlobal("document", { createElement: () => canvas });
	const image = { width: 4000, height: 3000, source: {} as CanvasImageSource, close() {} };
	for (const kind of ["avatar", "cover"] as const) {
		const result = await exportCrop(image, kind, { x: 2000, y: 1500, zoom: 1 });
		expect(result.type).toBe("image/jpeg");
		expect(result.size).toBeGreaterThan(0);
		expect(result.size).toBeLessThanOrEqual(5 * 1024 * 1024);
		expect(draw.mock.calls.at(-1)?.slice(-4)).toEqual([0, 0, cropOutput(kind).width, cropOutput(kind).height]);
		expect(canvas.width).toBe(0);
		expect(canvas.height).toBe(0);
	}
	canvas.toBlob.mockImplementationOnce((callback) =>
		callback(new Blob([new Uint8Array(6 * 1024 * 1024)], { type: "image/jpeg" })),
	);
	await exportCrop(image, "cover", { x: 2000, y: 1500, zoom: 1 });
	expect(canvas.toBlob).toHaveBeenLastCalledWith(expect.any(Function), "image/jpeg", 0.82);
});
it("does not report success when image processing is unavailable", () => {
	expect(() =>
		drawCrop(
			{ getContext: () => null } as unknown as HTMLCanvasElement,
			{ width: 10, height: 10, source: {} as CanvasImageSource, close() {} },
			"avatar",
			{ x: 5, y: 5, zoom: 1 },
		),
	).toThrow("无法处理");
});

it("rejects empty encoder results and frees the canvas on an export failure", async () => {
	const canvas = {
		width: 0,
		height: 0,
		getContext: () => ({ fillRect() {}, drawImage() {}, fillStyle: "" }),
		toBlob: (callback: (blob: Blob | null) => void) => callback(null),
	};
	vi.stubGlobal("document", { createElement: () => canvas });
	await expect(
		exportCrop({ width: 100, height: 100, source: {} as CanvasImageSource, close() {} }, "avatar", {
			x: 50,
			y: 50,
			zoom: 1,
		}),
	).rejects.toThrow("图片处理失败");
	expect(canvas.width).toBe(0);
	expect(canvas.height).toBe(0);
});
