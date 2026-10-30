import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { $session } from "../src/store";

vi.mock("../src/work/WorkRoot", () => ({ default: () => "work-root" }));

let container: HTMLElement;
let root: Root;
beforeEach(() => {
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
	vi.stubGlobal("document", document);
	vi.stubGlobal("location", { href: "http://localhost/", origin: "http://localhost", pathname: "/" });
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
	container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container as never);
	root = createRoot(container);
	$session.set({ actor: { id: "me", kind: "human", name: "Me" } });
});
afterEach(async () => {
	await act(() => root.unmount());
	$session.set(undefined);
	vi.unstubAllGlobals();
});

let seen = "";
function Path() {
	const p = useLocation().pathname;
	seen = p;
	return <i id="path">{p}</i>;
}

describe("旧 /pa 链接", () => {
	it("重定向到聊天列表，不再出现选择页", async () => {
		await act(async () =>
			root.render(
				<QueryClientProvider client={new QueryClient()}>
					<MemoryRouter initialEntries={["/pa"]}>
						<App />
						<Path />
					</MemoryRouter>
				</QueryClientProvider>,
			),
		);
		await act(async () => {
			for (let i = 0; i < 40 && seen === "/pa"; i++) await new Promise((r) => setTimeout(r, 50));
		});
		expect(seen).toMatch(/^\/(c\/.+)?$/);
		expect(container.textContent).not.toContain("选择代表你的");
	});
});
