import { parseHTML } from "linkedom";
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PhotoPicker, type PhotoPickerHandle } from "../src/components/PhotoPicker";
import { decodePhoto, exportCrop } from "../src/lib/photoCrop";

vi.mock("radix-ui", async () => {
	const { createElement: h, Fragment } = await import("react");
	const box =
		(tag: string) =>
		({ children }: { children?: React.ReactNode }) =>
			h(tag, null, children);
	return {
		Dialog: {
			Root: ({ open, children }: { open: boolean; children?: React.ReactNode }) =>
				open ? h(Fragment, null, children) : null,
			Portal: box("div"),
			Overlay: () => null,
			Content: box("section"),
			Title: box("h2"),
		},
	};
});
vi.mock("../src/lib/photoCrop", async (actual) => ({
	...(await actual<typeof import("../src/lib/photoCrop")>()),
	decodePhoto: vi.fn(),
	exportCrop: vi.fn(),
}));
let el: HTMLElement, root: Root;
const apply = vi.fn(),
	error = vi.fn(),
	close = vi.fn(),
	draw = vi.fn();
const picker = createRef<PhotoPickerHandle>();
const source = new File(["photo"], "source.jpg", { type: "image/jpeg" });
const output = new File(["crop"], "avatar.jpg", { type: "image/jpeg" });
beforeEach(async () => {
	const { document, window } = parseHTML("<html><body></body></html>");
	const create = document.createElement.bind(document);
	document.createElement = ((tag: string) => {
		const node = create(tag);
		if (tag === "canvas")
			Object.assign(node, { getContext: () => ({ fillRect() {}, drawImage: draw, fillStyle: "" }) });
		return node;
	}) as typeof document.createElement;
	vi.stubGlobal("document", document);
	vi.stubGlobal("window", window);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	window.matchMedia = vi.fn().mockReturnValue({ matches: true });
	el = create("div") as unknown as HTMLElement;
	document.body.appendChild(el as never);
	root = createRoot(el);
	vi.mocked(decodePhoto).mockResolvedValue({ width: 4000, height: 3000, source: {} as CanvasImageSource, close });
	vi.mocked(exportCrop).mockResolvedValue(output);
	await act(() => root.render(<PhotoPicker ref={picker} onApply={apply} onError={error} />));
});
afterEach(async () => {
	await act(() => root.unmount());
	vi.unstubAllGlobals();
	vi.resetAllMocks();
});
function required(selector: string) {
	const node = el.querySelector(selector);
	if (!node) throw Error(`Missing ${selector}`);
	return node;
}
function props(node: Element) {
	const key = Object.keys(node).find((name) => name.startsWith("__reactProps$"));
	if (!key) throw Error("Missing props");
	return (node as unknown as Record<string, Record<string, (event: unknown) => void>>)[key];
}
async function click(text: string) {
	const button = [...el.querySelectorAll("button")].find((item) => item.textContent === text);
	if (!button) throw Error(`Missing ${text}`);
	await act(async () => button.dispatchEvent(new window.Event("click", { bubbles: true })));
}
async function select(file = source) {
	await act(async () =>
		props(required('[aria-label="从相册选择照片"]')).onChange({
			target: { files: [file] },
			currentTarget: { value: "source.jpg" },
		}),
	);
}

it("mobile choices use explicit native camera/gallery inputs with the right camera facing", async () => {
	const native = vi.fn();
	(required('[aria-label="拍摄照片"]') as HTMLInputElement).click = native;
	await act(() => picker.current?.open("avatar"));
	expect(el.textContent).toContain("相册");
	expect(el.textContent).toContain("拍照");
	expect(native).not.toHaveBeenCalled();
	expect(required('[aria-label="拍摄照片"]').getAttribute("capture")).toBe("user");
	expect(required('[aria-label="从相册选择照片"]').getAttribute("accept")).toBe("image/*");
	await click("拍照");
	expect(native).toHaveBeenCalledOnce();
	await act(() => picker.current?.open("cover"));
	expect(required('[aria-label="拍摄照片"]').getAttribute("capture")).toBe("environment");
});
it("cancelling the crop leaves the existing profile image untouched and closes its decoded source", async () => {
	await act(() => picker.current?.open("avatar"));
	await click("相册");
	await select();
	expect(el.textContent).toContain("裁切头像");
	expect(draw).toHaveBeenCalled();
	expect(apply).not.toHaveBeenCalled();
	await click("取消");
	expect(apply).not.toHaveBeenCalled();
	expect(close).toHaveBeenCalledOnce();
	expect(el.querySelector("canvas")).toBeNull();
});
it("zoom and Done apply only the confirmed cropped file once", async () => {
	await act(() => picker.current?.open("cover"));
	await click("相册");
	await select();
	await act(() => props(required('[aria-label="照片缩放"]')).onChange({ target: { value: "3" } }));
	const frame = required('[aria-label="裁切区域，拖动或使用方向键调整照片"]');
	frame.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 100 }) as DOMRect;
	const pointer = (x: number) => ({ currentTarget: frame, pointerId: 1, clientX: x, clientY: 50, preventDefault() {} });
	await act(() => props(frame).onPointerDown(pointer(150)));
	await act(() => props(frame).onPointerMove(pointer(200)));
	await act(() => props(frame).onPointerUp(pointer(200)));
	await click("完成");
	expect(vi.mocked(exportCrop).mock.calls.at(-1)?.[2].x).toBeLessThan(2000);
	expect(exportCrop).toHaveBeenCalledWith(expect.anything(), "cover", expect.objectContaining({ zoom: 3 }));
	expect(apply).toHaveBeenCalledExactlyOnceWith("cover", output);
	expect(close).toHaveBeenCalledOnce();
});
it("decode errors do not replace the profile photo or pretend processing succeeded", async () => {
	vi.mocked(decodePhoto).mockRejectedValueOnce(new Error("照片格式无法读取"));
	await act(() => picker.current?.open("avatar"));
	await click("相册");
	await select();
	expect(el.textContent).toContain("照片格式无法读取");
	expect([...el.querySelectorAll("button")].find((item) => item.textContent === "完成")?.hasAttribute("disabled")).toBe(
		true,
	);
	expect(apply).not.toHaveBeenCalled();
	await click("取消");
	expect(el.querySelector("canvas")).toBeNull();
});
it("desktop opens the native gallery directly, without camera access or a sheet", async () => {
	window.matchMedia = vi.fn().mockReturnValue({ matches: false });
	const native = vi.fn();
	(required('[aria-label="从相册选择照片"]') as HTMLInputElement).click = native;
	await act(() => picker.current?.open("avatar"));
	expect(native).toHaveBeenCalledOnce();
	expect(el.textContent).not.toContain("拍照");
	expect(apply).not.toHaveBeenCalled();
});
