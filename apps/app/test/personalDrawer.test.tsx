import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useNavigate } from "react-router";
import { expect, it, vi } from "vitest";
import { PersonalAvatar, PersonalDrawerProvider } from "../src/components/PersonalDrawer";
import { $session } from "../src/store";

vi.mock("../src/pages/Me", () => ({ SettingsDialog: () => null }));
vi.mock("radix-ui", async () => {
	const { createContext, createElement: h, useContext, useEffect } = await import("react");
	const Context = createContext({ open: false, close: () => {} });
	const Content = (p: { children: React.ReactNode; onCloseAutoFocus: (event: { preventDefault(): void }) => void }) => {
		useEffect(() => () => p.onCloseAutoFocus({ preventDefault() {} }), []);
		return h("section", null, p.children);
	};
	return {
		Dialog: {
			Root: (p: { open: boolean; onOpenChange: (open: boolean) => void; children: React.ReactNode }) =>
				h(Context.Provider, { value: { open: p.open, close: () => p.onOpenChange(false) } }, p.children),
			Portal: (p: { children: React.ReactNode }) => (useContext(Context).open ? p.children : null),
			Overlay: () => null,
			Content,
			Title: (p: { children: React.ReactNode }) => h("h2", null, p.children),
			Close: (p: { children: React.ReactNode; "aria-label": string }) =>
				h("button", { "aria-label": p["aria-label"], onClick: useContext(Context).close }, p.children),
		},
	};
});

function Back() {
	const navigate = useNavigate();
	return (
		<button type="button" onClick={() => navigate(-1)}>
			browser back
		</button>
	);
}

it("关闭和浏览器返回都保留当前页，并恢复头像焦点", async () => {
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("HTMLElement", window.HTMLElement);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	$session.set({ actor: { id: "me", kind: "human", name: "Me" } });
	const node = document.createElement("div");
	document.body.appendChild(node);
	const root = createRoot(node as never);
	await act(() =>
		root.render(
			<MemoryRouter initialEntries={["/previous", "/"]} initialIndex={1}>
				<PersonalDrawerProvider>
					<PersonalAvatar />
					<Back />
					<input defaultValue="草稿" />
				</PersonalDrawerProvider>
			</MemoryRouter>,
		),
	);
	const avatar = node.querySelector('[aria-label="打开个人菜单"]') as unknown as HTMLElement;
	const focus = vi.spyOn(avatar, "focus");
	await act(() => avatar.click());
	expect(node.querySelector('[aria-label="关闭个人菜单"]')).not.toBeNull();
	await act(() => (node.querySelector('[aria-label="关闭个人菜单"]') as unknown as HTMLElement).click());
	expect(node.querySelector('[aria-label="关闭个人菜单"]')).toBeNull();
	expect(focus).toHaveBeenCalled();
	await act(() => avatar.click());
	await act(() => (node.querySelector("button:last-of-type") as unknown as HTMLElement).click());
	expect(node.querySelector('[aria-label="关闭个人菜单"]')).toBeNull();
	expect((node.querySelector("input") as unknown as HTMLInputElement).value).toBe("草稿");
	await act(() => root.unmount());
	$session.set(undefined);
	vi.unstubAllGlobals();
});
