import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Actor, Message } from "../src/api/types";
import { Bubble, Composer } from "../src/pages/Chat";
import { $session } from "../src/store";

const menu = vi.hoisted(() => ({ actions: [] as { key: string; onSelect(): void }[] }));
vi.mock("../src/work/ui/ActionMenu", () => ({
	ActionMenu: ({ actions }: { actions: typeof menu.actions }) => {
		menu.actions = actions;
		return null;
	},
}));
const api = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("../src/api", () => ({ api }));
vi.mock("../src/components/VerifySheet", () => ({ VerifySheet: () => null }));
let el: HTMLElement, root: Root, qc: QueryClient;
const members = [
	{ id: "person-a", name: "同名", kind: "human" },
	{ id: "person-b", name: "同名", kind: "human" },
	{ id: "bot", name: "研究 Bot", kind: "agent" },
] as Actor[];
beforeEach(() => {
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("document", document);
	vi.stubGlobal("window", window);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("location", { search: "" });
	vi.stubGlobal("sessionStorage", { getItem: () => null, removeItem: () => {}, setItem: () => {} });
	vi.stubGlobal("requestAnimationFrame", (f: () => void) => {
		f();
		return 1;
	});
	el = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(el as never);
	root = createRoot(el);
	qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	$session.set({ actor: { id: "self", name: "我", kind: "human" } });
	api.send.mockRejectedValue(new Error("network"));
});
afterEach(async () => {
	await act(() => root.unmount());
	qc.clear();
	$session.set(null);
	vi.unstubAllGlobals();
	vi.resetAllMocks();
});
async function render(ui: React.ReactNode) {
	await act(() =>
		root.render(
			<QueryClientProvider client={qc}>
				<MemoryRouter>{ui}</MemoryRouter>
			</QueryClientProvider>,
		),
	);
}
function required(selector: string) {
	const node = el.querySelector(selector);
	if (!node) throw new Error(`Missing control: ${selector}`);
	return node;
}
function props(node: Element) {
	const k = Object.keys(node).find((k) => k.startsWith("__reactProps$"));
	if (!k) throw new Error("Missing React input handler");
	return (node as unknown as Record<string, Record<string, (e: unknown) => void>>)[k];
}
async function type(value: string, caret = value.length) {
	const node = required("textarea");
	await act(() => props(node).onChange({ target: { value, selectionStart: caret, style: {}, scrollHeight: 20 } }));
}
async function click(node: Element) {
	await act(() => node.dispatchEvent(new window.Event("click", { bubbles: true })));
}
async function key(key: string, composing = false) {
	await act(() =>
		props(required("textarea")).onKeyDown({
			key,
			shiftKey: false,
			nativeEvent: { isComposing: composing },
			preventDefault: () => {},
		}),
	);
}
it("opens @ from typing, keeps same-name identities distinct and sends selected metadata", async () => {
	await render(<Composer convId="group" members={members} offline={false} onSend={() => {}} />);
	expect(el.querySelector("select")).toBeNull();
	await type("@");
	expect(el.querySelectorAll('[role="option"]')).toHaveLength(4);
	const input = el.querySelector("textarea") as HTMLTextAreaElement;
	input.setSelectionRange = () => {};
	await click(el.querySelectorAll('[role="option"]')[2]);
	expect(input.value).toBe("@同名 ");
	expect(el.querySelector('[role="listbox"]')?.parentElement?.getAttribute("aria-hidden")).toBe("true");
	await click(required('[aria-label="发送"]'));
	expect(api.send).toHaveBeenLastCalledWith("group", { type: "markdown", text: "@同名", mentions: ["person-b"] });
	await type("@同");
	await key("Escape");
	await click(required('[aria-label="发送"]'));
	expect(api.send).toHaveBeenLastCalledWith("group", { type: "markdown", text: "@同" });
});
it("supports @all with keyboard selection and does not submit composing input", async () => {
	await render(<Composer convId="group" members={members} offline={false} onSend={() => {}} />);
	(el.querySelector("textarea") as HTMLTextAreaElement).setSelectionRange = () => {};
	await type("@");
	await key("Enter", true);
	expect(api.send).not.toHaveBeenCalled();
	await key("Enter");
	expect((el.querySelector("textarea") as HTMLTextAreaElement).value).toBe("@所有人 ");
	await click(required('[aria-label="发送"]'));
	expect(api.send).toHaveBeenLastCalledWith("group", { type: "markdown", text: "@所有人", mentionAll: true });
});
it("keeps muted drafts editable and prevents both button and Enter sends", async () => {
	await render(
		<Composer convId="group" members={members} mutedUntil={Date.now() + 60000} offline={false} onSend={() => {}} />,
	);
	await type("稍后发送");
	expect(el.textContent).toContain("禁言至");
	expect((el.querySelector('[aria-label="发送"]') as HTMLButtonElement).disabled).toBe(true);
	await key("Enter");
	expect(api.send).not.toHaveBeenCalled();
	expect((el.querySelector("textarea") as HTMLTextAreaElement).value).toBe("稍后发送");
});
it("highlights only the current recipient or @all, not unrelated mentions", async () => {
	const message = {
		id: "m",
		convId: "c",
		seq: 1,
		senderId: "other",
		createdAt: Date.now(),
		content: { type: "text", text: "@我", mentions: ["self"] },
	} as Message;
	const bubble = (m: Message) => <Bubble m={m} actors={new Map()} onReply={() => {}} mine={false} group first last />;
	await render(bubble(message));
	expect(el.textContent).toContain("有人@你");
	await render(bubble({ ...message, content: { type: "text", text: "别人的消息", mentions: ["someone-else"] } }));
	expect(el.textContent).not.toContain("有人@你");
});

it("offers message pinning and announcement actions only when management callbacks are present", async () => {
	const message = {
		id: "m",
		convId: "c",
		seq: 1,
		senderId: "other",
		createdAt: Date.now(),
		content: { type: "text", text: "重要消息" },
	} as Message;
	const pin = vi.fn(),
		announce = vi.fn();
	await render(
		<Bubble
			m={message}
			actors={new Map()}
			onReply={() => {}}
			mine={false}
			group
			first
			last
			onPin={pin}
			onAnnounce={announce}
		/>,
	);
	const action = required('[aria-label="消息操作，右键或长按也可打开"]') as HTMLButtonElement;
	action.getBoundingClientRect = () => ({ left: 0, bottom: 0 }) as DOMRect;
	await click(action);
	expect(menu.actions.map((x) => x.key)).toEqual(["reply", "copy", "pin", "announce"]);
	menu.actions.find((x) => x.key === "pin")?.onSelect();
	menu.actions.find((x) => x.key === "announce")?.onSelect();
	expect(pin).toHaveBeenCalledOnce();
	expect(announce).toHaveBeenCalledOnce();
	await render(<Bubble m={message} actors={new Map()} onReply={() => {}} mine={false} group first last />);
	expect(menu.actions.map((x) => x.key)).toEqual(["reply", "copy"]);
});
