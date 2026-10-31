import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublishDialog, SellerWorkspace } from "../src/components/market/SellPanel";
import { uploadMarketImage } from "../src/market/uploadImage";

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
vi.mock("../src/market/uploadImage", () => ({ uploadMarketImage: vi.fn() }));

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

it("实物发布可选择图片，旧示意图不预览", async () => {
	await renderDialog(vi.fn().mockResolvedValue(false), 1);
	expect(container.querySelector("img")).toBeNull();
	expect(container.querySelector('input[type="file"]')).not.toBeNull();
});

it("上传显示进度，成功后预览并可移除", async () => {
	let finish!: (url: string) => void;
	vi.mocked(uploadMarketImage).mockImplementation((_file, progress) => {
		progress(42);
		return new Promise((resolve) => {
			finish = resolve;
		});
	});
	await renderDialog(vi.fn(), 1);
	const input = container.querySelector('input[type="file"]') as HTMLInputElement;
	Object.defineProperty(input, "files", { value: [{ type: "image/png", size: 10 }] });
	await act(() => input.dispatchEvent(new win.Event("change", { bubbles: true })));
	expect(container.textContent).toContain("上传中 42%");
	expect(input.disabled).toBe(true);
	await act(async () => finish("https://example.test/photo.png"));
	expect(container.querySelector('img[alt="图片预览"]')?.getAttribute("src")).toBe("https://example.test/photo.png");
	const remove = [...container.querySelectorAll("button")].find((button) => button.textContent === "移除图片");
	await act(() => remove?.dispatchEvent(new win.Event("click", { bubbles: true })));
	expect(container.querySelector('img[alt="图片预览"]')).toBeNull();
});

it("上传失败显示错误并允许重试", async () => {
	vi.mocked(uploadMarketImage).mockRejectedValue(new Error("图片上传失败，请重试"));
	await renderDialog(vi.fn(), 1);
	const input = container.querySelector('input[type="file"]') as HTMLInputElement;
	Object.defineProperty(input, "files", { value: [{ type: "image/png", size: 10 }] });
	await act(async () => input.dispatchEvent(new win.Event("change", { bubbles: true })));
	expect(container.textContent).toContain("图片上传失败，请重试");
	expect(input.disabled).toBe(false);
});

it("旧草稿发布不带假图，确认页无说明", async () => {
	const onPublish = vi.fn().mockResolvedValue(false);
	await renderDialog(onPublish);
	expect(container.querySelector("img")).toBeNull();
	expect(container.textContent).not.toContain("所有人都可在市场看到");
	expect(container.textContent).not.toContain("目前不支持站内交易");
	await submit();
	expect(onPublish).toHaveBeenCalledWith(expect.objectContaining({ image: "" }));
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
	expect(container.textContent).not.toContain("不会出现在他人的市场列表中");
});

it("下架须确认，取消不操作，重新上架直接执行", async () => {
	const onToggle = vi.fn();
	const listing = {
		...DRAFT,
		id: "one",
		price: 1200,
		mine: true,
		tags: [],
		facts: [],
		missing: [],
		metrics: { agentViews: 0, shortlists: 0, humanViews: 0, inquiries: 0 },
	};
	const renderSeller = (paused = false) =>
		root.render(
			<SellerWorkspace
				listings={[{ ...listing, paused } as never]}
				saved={[]}
				tab={paused ? "paused" : "published"}
				onTab={vi.fn()}
				onEdit={vi.fn()}
				onToggle={onToggle}
				onOpen={vi.fn()}
				onSave={vi.fn()}
				onStats={vi.fn()}
				onBrowse={vi.fn()}
			/>,
		);
	const click = async (label: string) => {
		const button = [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
		expect(button).toBeTruthy();
		await act(() => button?.click());
	};
	await act(() => renderSeller());
	await click("下架");
	expect(onToggle).not.toHaveBeenCalled();
	await click("取消");
	expect(onToggle).not.toHaveBeenCalled();
	await click("下架");
	await click("确认下架");
	expect(onToggle).toHaveBeenCalledOnce();
	expect(onToggle).toHaveBeenCalledWith("one");
	await act(() => renderSeller(true));
	await click("重新上架");
	expect(onToggle).toHaveBeenCalledTimes(2);
});

it("旧草稿兼容标签字段，未确认标签随下一步和发布保存", async () => {
	const onPublish = vi.fn().mockResolvedValue(false);
	store.set(draftKey, JSON.stringify({ form: { ...DRAFT, tagInput: " #旅 行 " }, step: 1 }));
	await act(() => root.render(<PublishDialog open close={() => {}} storageKey={KEY} onPublish={onPublish} />));
	expect(container.querySelector("select")).toBeNull();
	await submit();
	const saved = JSON.parse(store.get(draftKey) as string);
	expect(saved.form.tags).toEqual(["旅行"]);
	expect(saved.form.tagInput).toBe("");
	expect(saved.form.category).toBe(DRAFT.category);
	await submit();
	expect(container.textContent).toContain("#旅行");
	expect(container.textContent).not.toContain(DRAFT.category);
	await submit();
	expect(onPublish).toHaveBeenCalledWith(expect.objectContaining({ tags: ["旅行"], category: DRAFT.category }));
});

it("标签添加去重，删除后保存到草稿", async () => {
	store.set(draftKey, JSON.stringify({ form: { ...DRAFT, tags: ["旅行"], tagInput: "#旅行" }, step: 1 }));
	await act(() => root.render(<PublishDialog open close={() => {}} storageKey={KEY} onPublish={vi.fn()} />));
	const add = [...container.querySelectorAll("button")].find(
		(button) => button.textContent === "添加",
	) as HTMLButtonElement;
	await act(() => add.dispatchEvent(new win.Event("click", { bubbles: true })));
	expect(JSON.parse(store.get(draftKey) as string).form.tags).toEqual(["旅行"]);
	expect(JSON.parse(store.get(draftKey) as string).form.tagInput).toBe("");
	const remove = container.querySelector('button[aria-label="删除标签 旅行"]') as HTMLButtonElement;
	await act(() => remove.dispatchEvent(new win.Event("click", { bubbles: true })));
	expect(JSON.parse(store.get(draftKey) as string).form.tags).toEqual([]);
});

it.each([
	{ tags: [], tagInput: "标".repeat(25), message: "每个标签最多 24 个字" },
	{ tags: Array.from({ length: 10 }, (_, i) => String(i)), tagInput: "新标签", message: "最多添加 10 个标签" },
])("标签超出限制时阻止下一步并保留输入 $message", async ({ tags, tagInput, message }) => {
	store.set(draftKey, JSON.stringify({ form: { ...DRAFT, tags, tagInput }, step: 1 }));
	await act(() => root.render(<PublishDialog open close={() => {}} storageKey={KEY} onPublish={vi.fn()} />));
	await submit();
	expect(container.textContent).toContain(message);
	expect(JSON.parse(store.get(draftKey) as string).step).toBe(1);
	expect(JSON.parse(store.get(draftKey) as string).form.tagInput).toBe(tagInput);
});

it("编辑保留原标签与分类，旧草稿缺标签时也不覆盖原值", async () => {
	const listing = {
		...DRAFT,
		id: "tagged",
		price: 1200,
		tags: ["摄影", "同城"],
		facts: [],
		missing: [],
		seller: "我",
		sellerRole: "个人",
		agent: false,
		createdAt: 1,
		metrics: { agentViews: 0, shortlists: 0, humanViews: 0, inquiries: 0 },
	};
	store.set(`${KEY}:publish:tagged`, JSON.stringify({ form: DRAFT, step: 1 }));
	const onPublish = vi.fn().mockResolvedValue(false);
	await act(() =>
		root.render(
			<PublishDialog open close={() => {}} editing={listing as never} storageKey={KEY} onPublish={onPublish} />,
		),
	);
	expect(container.textContent).toContain("#摄影");
	expect(container.textContent).toContain("#同城");
	await submit();
	await submit();
	await submit();
	expect(onPublish).toHaveBeenCalledWith(expect.objectContaining({ tags: ["摄影", "同城"], category: DRAFT.category }));
});
