import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor, Card, CardFace } from "../src/api/types";
import { CardFaceView, CardQrView } from "../src/components/card/CardFace";
import { IdentityDetail } from "../src/components/IdentityDetail";
import { identityHeadline, profileError, profileForm } from "../src/lib/profileEditor";
import { uploadMarketImage } from "../src/market/uploadImage";
import { Me } from "../src/pages/Me";
import { ProfileEdit } from "../src/pages/ProfileEdit";
import { $session } from "../src/store";

const api = vi.hoisted(() => ({ cards: vi.fn(), saveProfile: vi.fn(), contacts: vi.fn() }));
vi.mock("../src/api", () => ({ api }));
vi.mock("../src/market/uploadImage", async (actual) => ({
	...(await actual<typeof import("../src/market/uploadImage")>()),
	uploadMarketImage: vi.fn(),
}));
const actor: Actor = { id: "me", kind: "human", name: "原昵称", code: "ABC123" };
const card: Card = {
	id: "card",
	ownerId: "me",
	respondentId: "me",
	kind: "default",
	mine: true,
	title: "我的名片",
	summary: null,
	markdown: " 开场白 ",
	tagline: "签名",
	status: "published",
	rev: 1,
	updatedAt: 1,
};
let el: HTMLElement, root: Root, qc: QueryClient;
beforeEach(() => {
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("document", document);
	vi.stubGlobal("window", window);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("location", { origin: "https://yonderbot.net" });
	vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
	vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
	el = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(el as never);
	root = createRoot(el);
	qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	api.cards.mockResolvedValue([card]);
	api.contacts.mockResolvedValue([]);
	api.saveProfile.mockResolvedValue({ actor: { ...actor, name: "新昵称" }, card: { ...card, title: "新昵称" } });
	vi.mocked(uploadMarketImage).mockResolvedValue("https://cdn.yonderbot.net/profile.png");
	$session.set({ actor });
});
afterEach(async () => {
	await act(() => root.unmount());
	qc.clear();
	$session.set(undefined);
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.resetAllMocks();
});
function Path() {
	const location = useLocation();
	return (
		<output>
			{location.pathname}
			{location.search}
		</output>
	);
}
async function render(entries: { pathname: string; search?: string; state?: unknown }[] = [{ pathname: "/me/edit" }]) {
	await act(() =>
		root.render(
			<QueryClientProvider client={qc}>
				<MemoryRouter initialEntries={entries}>
					<Path />
					<Routes>
						<Route path="/me/edit" element={<ProfileEdit />} />
						<Route path="/me" element={<div>个人概览</div>} />
						<Route path="/legacy" element={<Me />} />
						<Route path="/login" element={<div>登录</div>} />
					</Routes>
				</MemoryRouter>
			</QueryClientProvider>,
		),
	);
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 15));
	});
}
function required(selector: string) {
	const node = el.querySelector(selector);
	if (!node) throw Error(`Missing ${selector}`);
	return node;
}
function props(node: Element) {
	const key = Object.keys(node).find((value) => value.startsWith("__reactProps$"));
	if (!key) throw Error("Missing React handler");
	return (node as unknown as Record<string, Record<string, (event: unknown) => void>>)[key];
}
async function name(value: string) {
	await act(() => props(required("input[required]")).onChange({ target: { value } }));
}
async function submit() {
	await act(async () => props(required("form")).onSubmit({ preventDefault() {} }));
}
async function click(label: string) {
	await act(() => required(`[aria-label="${label}"]`).dispatchEvent(new window.Event("click", { bubbles: true })));
}

it("loads the default card, preserves greeting whitespace, and saves the complete atomic payload", async () => {
	await render([{ pathname: "/me" }, { pathname: "/me/edit", state: { appFrom: "/me" } }]);
	await name(" 新昵称 ");
	await act(() => props(required('[aria-label="展示个性签名"]')).onChange({ target: { checked: false } }));
	await submit();
	expect(api.saveProfile).toHaveBeenCalledWith({
		name: "新昵称",
		avatarUrl: null,
		tagline: "签名",
		markdown: " 开场白 ",
		coverUrl: null,
		visibility: { signature: false, code: true, greeting: true },
	});
	expect($session.get()?.actor.name).toBe("新昵称");
	expect(qc.getQueryData<Card>(["card", "card"])?.title).toBe("新昵称");
	expect(required("output").textContent).toBe("/me");
	expect(el.textContent).not.toContain("二维码");
});

it("keeps the full draft on a server failure and guards duplicate saves", async () => {
	let reject!: (error: Error) => void;
	api.saveProfile.mockReturnValue(
		new Promise((_resolve, fail) => {
			reject = fail;
		}),
	);
	await render();
	await name("保留草稿");
	await act(() => {
		const handler = props(required("form")).onSubmit;
		handler({ preventDefault() {} });
		handler({ preventDefault() {} });
	});
	expect(api.saveProfile).toHaveBeenCalledTimes(1);
	await act(async () => reject(new Error("保存失败：服务暂不可用")));
	expect(required("input[required]").getAttribute("value")).toBe("保留草稿");
	expect(el.textContent).toContain("保存失败：服务暂不可用");
	expect(required("output").textContent).toBe("/me/edit");
	expect($session.get()?.actor.name).toBe("原昵称");
});

it("previews locally, uploads only on Save, and restores default images", async () => {
	await render();
	const file = new File([new Uint8Array([1])], "avatar.png", { type: "image/png" });
	await act(() =>
		props(required('[aria-label="选择头像"]')).onChange({
			target: { files: [file] },
			currentTarget: { value: "avatar.png" },
		}),
	);
	expect(uploadMarketImage).not.toHaveBeenCalled();
	expect(el.querySelector('img[src="blob:preview"]')).toBeTruthy();
	await submit();
	expect(uploadMarketImage).toHaveBeenCalledWith(file, expect.any(Function));
	expect(api.saveProfile.mock.calls[0][0].avatarUrl).toBe("https://cdn.yonderbot.net/profile.png");
});

it("resetting both images saves null and never revives the legacy cover", async () => {
	$session.set({ actor: { ...actor, avatarUrl: "https://cdn.yonderbot.net/avatar.png" } });
	api.cards.mockResolvedValue([
		{
			...card,
			face: { theme: "mist", coverUrl: "https://cdn.yonderbot.net/cover.png" },
			display: { kind: "svg", source: "<svg/>" },
		},
	]);
	await render();
	const restore = async (text: string) => {
		const button = [...el.querySelectorAll("button")].find((item) => item.textContent === text);
		expect(button).toBeTruthy();
		await act(() => button?.dispatchEvent(new window.Event("click", { bubbles: true })));
	};
	await restore("恢复默认背景");
	await restore("恢复默认头像");
	expect(el.querySelector("img")).toBeNull();
	expect(el.querySelector("iframe")).toBeNull();
	await submit();
	expect(api.saveProfile.mock.calls[0][0]).toMatchObject({ avatarUrl: null, coverUrl: null });
});

it("does not seed a persona when the default card is missing", async () => {
	api.cards.mockResolvedValue([{ ...card, kind: "persona", tagline: "另一张卡" }]);
	await render();
	await submit();
	expect(api.saveProfile.mock.calls[0][0].tagline).toBe("");
});

it("blocks anonymous editing and keeps a usable return when loading fails", async () => {
	$session.set({ actor: { ...actor, anonymous: true } });
	await render();
	expect(required("output").textContent).toBe("/login");
});
it("loading errors offer both retry and return controls", async () => {
	api.cards.mockRejectedValue(new Error("offline"));
	await render();
	expect(el.textContent).toContain("个人资料加载失败");
	await click("返回我的");
	expect(required("output").textContent).toBe("/me");
});
it("redirects the legacy card creation entry to the separate editor", async () => {
	await render([{ pathname: "/legacy", search: "?card=new" }]);
	expect(required("output").textContent).toBe("/me/edit");
});

describe("validation and public display", () => {
	it("requires a name, accepts Unicode character limits and rejects controls and unsafe images", () => {
		const form = profileForm(actor);
		expect(profileError({ ...form, name: " " })).toContain("昵称");
		expect(profileError({ ...form, name: "😀".repeat(40) })).toBeUndefined();
		expect(profileError({ ...form, name: "😀".repeat(41) })).toContain("昵称");
		expect(profileError({ ...form, name: "a\nb" })).toContain("控制");
		expect(profileError({ ...form, tagline: "字".repeat(121) })).toContain("120");
		expect(profileError({ ...form, markdown: "字".repeat(2001) })).toContain("2000");
		expect(profileError({ ...form, avatarUrl: "javascript:alert(1)" })).toContain("图片");
	});
	it("hidden or explicitly empty signatures never fall back to old headlines and summaries", () => {
		const face: CardFace = {
			theme: "mist",
			headline: "旧签名",
			visibility: { signature: false, code: false, greeting: false },
		};
		expect(identityHeadline({ ...card, face }, "旧摘要")).toBeUndefined();
		expect(
			identityHeadline(
				{ ...card, tagline: "", face: { ...face, visibility: { signature: true, code: false, greeting: false } } },
				"旧摘要",
			),
		).toBeUndefined();
		const value = {
			...card,
			face: { ...face, coverUrl: null },
			markdown: "隐私开场白",
			display: { kind: "svg" as const, source: "<svg/>" },
		};
		const html = renderToStaticMarkup(
			<MemoryRouter>
				<IdentityDetail actor={{ ...actor, summary: "旧摘要" }} card={value} />
			</MemoryRouter>,
		);
		expect(html).toContain(actor.name);
		for (const hidden of ["旧签名", "旧摘要", "隐私开场白", "ABC123", "iframe"]) expect(html).not.toContain(hidden);
		const qr = renderToStaticMarkup(
			<CardQrView actor={actor} url="https://yonderbot.net/u/abc123" headline="旧签名" face={face} />,
		);
		expect(qr).not.toContain("旧签名");
		expect(qr).toContain(actor.name);
	});
	it("legacy cover remains until explicitly reset, and an empty section stays bare", () => {
		const base = {
			theme: "mist" as const,
			sticker: { url: "https://cdn.yonderbot.net/old.png", frame: "none" as const },
		};
		const legacy = renderToStaticMarkup(
			<CardFaceView name={actor.name} face={base} display={{ kind: "svg", source: "<svg/>" }} />,
		);
		expect(legacy).toContain("iframe");
		const reset = renderToStaticMarkup(
			<CardFaceView
				name={actor.name}
				face={{ ...base, coverUrl: null, section: { title: "", body: "" } }}
				display={{ kind: "svg", source: "<svg/>" }}
			/>,
		);
		expect(reset).not.toContain("iframe");
		expect(reset).not.toContain("old.png");
		expect(reset).toContain(actor.name);
	});
});

it("does not authorize a second upload or save into a newly switched account", async () => {
	let finish!: (url: string) => void;
	vi.mocked(uploadMarketImage).mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	await render();
	for (const kind of ["头像", "背景"]) {
		const file = new File([new Uint8Array([1])], `${kind}.png`, { type: "image/png" });
		await act(() =>
			props(required(`[aria-label="选择${kind}"]`)).onChange({
				target: { files: [file] },
				currentTarget: { value: "file.png" },
			}),
		);
	}
	await submit();
	expect(uploadMarketImage).toHaveBeenCalledTimes(1);
	await act(() => $session.set({ actor: { ...actor, id: "another", name: "另一账号" } }));
	await act(async () => finish("https://cdn.yonderbot.net/avatar.png"));
	expect(uploadMarketImage).toHaveBeenCalledTimes(1);
	expect(api.saveProfile).not.toHaveBeenCalled();
});

it("an upload failure retains the file and text for retry without sending a partial profile", async () => {
	vi.mocked(uploadMarketImage).mockRejectedValueOnce(new Error("图片上传超时，请重试"));
	await render();
	await name("需要保留");
	const file = new File([new Uint8Array([1])], "avatar.webp", { type: "image/webp" });
	await act(() =>
		props(required('[aria-label="选择头像"]')).onChange({
			target: { files: [file] },
			currentTarget: { value: "file.webp" },
		}),
	);
	await submit();
	expect(api.saveProfile).not.toHaveBeenCalled();
	expect(el.textContent).toContain("图片上传超时");
	expect(required("input[required]").getAttribute("value")).toBe("需要保留");
	expect(el.querySelector('img[src="blob:preview"]')).toBeTruthy();
	await submit();
	expect(api.saveProfile).toHaveBeenCalledTimes(1);
});

it("rejects unsupported files and removes failed preview images safely", async () => {
	await render();
	await act(() =>
		props(required('[aria-label="选择头像"]')).onChange({
			target: { files: [new File(["bad"], "image.gif", { type: "image/gif" })] },
			currentTarget: { value: "file.gif" },
		}),
	);
	expect(el.textContent).toContain("JPEG、PNG 或 WebP");
	expect(el.querySelector("img")).toBeNull();
	const file = new File([new Uint8Array([1])], "avatar.png", { type: "image/png" });
	await act(() =>
		props(required('[aria-label="选择头像"]')).onChange({
			target: { files: [file] },
			currentTarget: { value: "file.png" },
		}),
	);
	await act(() => props(required('img[src="blob:preview"]')).onError({}));
	expect(el.querySelector("img")).toBeNull();
	expect(el.textContent).toContain(actor.name);
});
