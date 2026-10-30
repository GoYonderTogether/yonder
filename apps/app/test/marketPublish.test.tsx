import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublishDialog } from "../src/components/market/SellPanel";

vi.mock("radix-ui", async () => {
	const { createElement: h, Fragment } = await import("react");
	const box = (tag: string) => (p: { children?: React.ReactNode }) => h(tag, null, p.children);
	return {
		Dialog: {
			Root: (p: { open: boolean; children?: React.ReactNode }) => (p.open ? h(Fragment, null, p.children) : null),
			Portal: box("div"),
			Overlay: () => null,
			Content: box("section"),
			Title: box("h2"),
			Description: box("p"),
			Close: (p: { children?: React.ReactNode }) => h(Fragment, null, p.children),
		},
	};
});
vi.mock("../src/ui/Toast", () => ({ toast: vi.fn() }));

const KEY = "yonder-market-demo:v1:guest";
const DRAFT = {
	kind: "item",
	category: "数码好物",
	title: "旧相机",
	description: "成色好，含镜头",
	price: "1200",
	unit: "",
	location: "上海",
	delivery: "同城面交",
	discoverable: true,
	image: "/market/camera.jpg",
};

let win: Window & typeof globalThis;
let container: HTMLElement;
let root: Root;
let store: Map<string, string>;

const draftKey = `${KEY}:publish:new`;

beforeEach(() => {
	const { document, window } = parseHTML("<html><body></body></html>");
	win = window as unknown as Window & typeof globalThis;
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	store = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => void store.set(key, String(value)),
		removeItem: (key: string) => void store.delete(key),
	});
	container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container as never);
	root = createRoot(container);
});

afterEach(async () => {
	await act(() => root.unmount());
	vi.unstubAllGlobals();
	vi.resetAllMocks();
});

async function renderDialog(onPublish: (listing: unknown) => Promise<boolean>, step = 3) {
	store.set(draftKey, JSON.stringify({ form: DRAFT, step }));
	await act(() => root.render(<PublishDialog open close={() => {}} storageKey={KEY} onPublish={onPublish as never} />));
}

async function submit() {
	const form = container.querySelector("form");
	expect(form).not.toBeNull();
	await act(async () => {
		form?.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
	});
}

describe("PublishDialog 发布失败不清草稿（B1）", () => {
	it("发布失败后草稿仍在", async () => {
		const onPublish = vi.fn().mockResolvedValue(false);
		await renderDialog(onPublish);
		await submit();
		expect(onPublish).toHaveBeenCalledOnce();
		expect(store.has(draftKey)).toBe(true);
	});

	it("发布抛错时草稿仍在", async () => {
		const onPublish = vi.fn().mockRejectedValue(new Error("网络错误"));
		await renderDialog(onPublish);
		await submit();
		expect(store.has(draftKey)).toBe(true);
	});

	it("发布成功后清掉草稿", async () => {
		const onPublish = vi.fn().mockResolvedValue(true);
		await renderDialog(onPublish);
		await submit();
		expect(store.has(draftKey)).toBe(false);
	});
});

it("本地图片上传入口禁用并说明（B1）", async () => {
	await renderDialog(vi.fn().mockResolvedValue(false), 1);
	const text = container.textContent ?? "";
	expect(text).toContain("图片上传暂未开放");
	expect(container.querySelector('input[type="file"]')).toBeNull();
});

it("发布确认说明可见范围和交易边界", async () => {
	await renderDialog(vi.fn());
	expect(container.textContent).toContain("所有人都可在市场看到，未登录访客也可查看");
	expect(container.textContent).toContain("目前不支持站内交易");
});

it("必填标识与不同类型的校验一致", async () => {
	await renderDialog(vi.fn(), 1);
	expect(container.textContent).toContain("标题（必填）");
	expect(container.textContent).toContain("描述（必填）");
	expect(container.querySelectorAll('[aria-required="true"]')).toHaveLength(2);
	await submit();
	expect(container.textContent).toContain("价格（元，必填）");
	expect(container.textContent).toContain("所在城市（必填）");
	expect(container.textContent).toContain("交付方式（必填）");
	expect(container.querySelectorAll('[aria-required="true"]')).toHaveLength(3);
});

it("创意发布的金额可选，参与方式必填", async () => {
	store.set(draftKey, JSON.stringify({ form: { ...DRAFT, kind: "idea", discoverable: false }, step: 2 }));
	await act(() => root.render(<PublishDialog open close={() => {}} storageKey={KEY} onPublish={vi.fn()} />));
	expect(container.textContent).toContain("金额（可留空，面议）");
	expect(container.textContent).toContain("参与方式（必填）");
	expect(container.querySelectorAll('[aria-required="true"]')).toHaveLength(2);
	await submit();
	expect(container.textContent).toContain("不会出现在他人的市场列表中");
	expect(container.textContent).toContain("知道详情链接的人仍可查看");
});
