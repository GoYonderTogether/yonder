import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Message } from "../src/api/types";
import { SocialPresence } from "../src/components/chat/SocialPresence";
import { historyScrollBehavior, newMessageBatch, useNewMessages } from "../src/lib/newMessages";

it("animates only new bounded arrivals, not first paint, old pages or refetches", () => {
	const items = [
		{ id: "1", seq: 1 },
		{ id: "2", seq: 2 },
	];
	expect(newMessageBatch(undefined, items).ids).toEqual([]);
	expect(newMessageBatch(2, items).ids).toEqual([]);
	expect(newMessageBatch(100, items).highest).toBe(100);
	expect(newMessageBatch(2, [...items, { id: "3", seq: 3 }]).ids).toEqual(["3"]);
	expect(
		newMessageBatch(
			0,
			Array.from({ length: 120 }, (_, i) => ({ id: String(i), seq: i + 1 })),
		).ids,
	).toHaveLength(20);
});
let root: Root, host: HTMLElement;
beforeEach(() => {
	vi.useFakeTimers();
	const { window, document } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	host = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(host as never);
	root = createRoot(host);
});
afterEach(async () => {
	await act(() => root.unmount());
	vi.useRealTimers();
	vi.unstubAllGlobals();
});
it("retains a closing panel only for exit, makes it inert, then unmounts", async () => {
	await act(() =>
		root.render(
			<SocialPresence open>
				<section>群设置</section>
			</SocialPresence>,
		),
	);
	expect(host.querySelector('[data-state="open"]')).not.toBeNull();
	await act(() =>
		root.render(
			<SocialPresence open={false}>
				<section>changed</section>
			</SocialPresence>,
		),
	);
	const closing = host.querySelector('[data-state="closed"]');
	expect(closing?.hasAttribute("inert")).toBe(true);
	expect(closing?.getAttribute("aria-hidden")).toBe("true");
	expect(host.textContent).toContain("群设置");
	await act(() => vi.advanceTimersByTime(180));
	expect(host.textContent).toBe("");
});
it("a refetch cannot leave the new-message animation flag stuck on", async () => {
	function Probe({ items }: { items: Message[] }) {
		const fresh = useNewMessages(items);
		return <span>{[...fresh].join(",")}</span>;
	}
	const first = [{ id: "one", seq: 1 }] as Message[];
	await act(() => root.render(<Probe items={first} />));
	await act(() => root.render(<Probe items={[...first, { id: "two", seq: 2 } as Message]} />));
	expect(host.textContent).toBe("two");
	await act(() => root.render(<Probe items={[...first, { id: "two", seq: 2 } as Message]} />));
	await act(() => vi.advanceTimersByTime(260));
	expect(host.textContent).toBe("");
});

it("history navigation honors a reduced-motion preference", () => {
	window.matchMedia = (() => ({ matches: true })) as typeof window.matchMedia;
	expect(historyScrollBehavior()).toBe("auto");
	window.matchMedia = (() => ({ matches: false })) as typeof window.matchMedia;
	expect(historyScrollBehavior()).toBe("smooth");
});
