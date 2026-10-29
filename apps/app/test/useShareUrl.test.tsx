import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useShareUrl } from "../src/lib/useShareUrl";
import { $session } from "../src/store";

const api = vi.hoisted(() => ({ createShareLink: vi.fn() }));
vi.mock("../src/api", () => ({ api }));

let container: HTMLElement;
let root: Root;
const store: Record<string, string> = {};

function Probe({ enabled = true }: { enabled?: boolean }) {
	const url = useShareUrl({ kind: "card", targetId: "c1", path: "/u/abc" }, "https://card.example/u/abc", enabled);
	return <p id="url">{url}</p>;
}

beforeEach(() => {
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("location", { origin: "https://card.example" });
	vi.stubGlobal("localStorage", {
		getItem: (k: string) => store[k] ?? null,
		setItem: (k: string, v: string) => {
			store[k] = v;
		},
	});
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container as never);
	root = createRoot(container);
});
afterEach(async () => {
	await act(() => root.unmount());
	vi.unstubAllGlobals();
	vi.resetAllMocks();
	$session.set(undefined);
});

async function mount(enabled = true) {
	await act(() =>
		root.render(
			<QueryClientProvider client={new QueryClient()}>
				<Probe enabled={enabled} />
			</QueryClientProvider>,
		),
	);
}
const shown = () => container.querySelector("#url")?.textContent;

describe("useShareUrl", () => {
	it("uses the server share link for a signed-in owner and remembers the token", async () => {
		$session.set({ actor: { id: "u1", name: "我", kind: "human" } });
		api.createShareLink.mockResolvedValue({ token: "tok", kind: "card", targetId: "c1", url: "https://x/?share=tok" });
		await mount();
		await vi.waitFor(() => expect(shown()).toBe("https://card.example/u/abc?share=tok"));
		expect(api.createShareLink).toHaveBeenCalledWith({ kind: "card", targetId: "c1" });
		expect(store["yonder.shareLinks"]).toContain("tok");
	});

	it("keeps the plain url for guests and when the request fails", async () => {
		$session.set({ actor: { id: "g", name: "访客", kind: "human", anonymous: true } });
		await mount();
		expect(shown()).toBe("https://card.example/u/abc");
		expect(api.createShareLink).not.toHaveBeenCalled();
		$session.set({ actor: { id: "u1", name: "我", kind: "human" } });
		api.createShareLink.mockRejectedValue(new Error("forbidden"));
		await mount();
		await vi.waitFor(() => expect(api.createShareLink).toHaveBeenCalled());
		expect(shown()).toBe("https://card.example/u/abc");
	});

	it("does not request a link until enabled", async () => {
		$session.set({ actor: { id: "u1", name: "我", kind: "human" } });
		await mount(false);
		expect(api.createShareLink).not.toHaveBeenCalled();
	});
});
