import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Listing } from "../src/market/types";
import { useListingExpiry } from "../src/market/useListingExpiry";

let root: Root, node: HTMLElement, client: QueryClient;
beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(10_000);
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	node = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(node as never);
	root = createRoot(node);
	client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(async () => {
	await act(() => root.unmount());
	client.clear();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});
function Feed({ query }: { query: () => Promise<Listing[]> }) {
	const result = useQuery({ queryKey: ["market-listings", "feed", { mine: true, status: "active" }], queryFn: query });
	useListingExpiry(result.data ?? [], true);
	return <p>{(result.data ?? []).map((item) => item.id).join(",")}</p>;
}
async function render(query: () => Promise<Listing[]>) {
	await act(async () => {
		root.render(
			<QueryClientProvider client={client}>
				<Feed query={query} />
			</QueryClientProvider>,
		);
	});
	await act(async () => {
		await vi.advanceTimersByTimeAsync(1);
	});
}
it("refreshes the open owner feed at each loaded expiry so posts move out without manual reload", async () => {
	const first = { id: "first", expiresAt: 11_000 } as Listing,
		second = { id: "second", expiresAt: 12_000 } as Listing;
	const query = vi.fn(async () => [first, second].filter((item) => (item.expiresAt ?? Infinity) > Date.now()));
	await render(query);
	expect(query).toHaveBeenCalledTimes(1);
	expect(node.textContent).toBe("first,second");
	await act(async () => {
		await vi.advanceTimersByTimeAsync(1001);
	});
	expect(query).toHaveBeenCalledTimes(2);
	expect(node.textContent).toBe("second");
	await act(async () => {
		await vi.advanceTimersByTimeAsync(1000);
	});
	expect(query).toHaveBeenCalledTimes(3);
	expect(node.textContent).toBe("");
});
it("clamps long deadlines without refreshing early or overflowing the JavaScript timeout", async () => {
	const deadline = Date.now() + 30 * 86400_000;
	const query = vi.fn(async () => (Date.now() < deadline ? [{ id: "long", expiresAt: deadline } as Listing] : []));
	await render(query);
	await act(async () => {
		await vi.advanceTimersByTimeAsync(2_147_483_647);
	});
	expect(query).toHaveBeenCalledTimes(1);
	await act(async () => {
		await vi.advanceTimersByTimeAsync(deadline - Date.now() + 1);
	});
	expect(query).toHaveBeenCalledTimes(2);
	expect(node.textContent).toBe("");
});
it("cleans up its deadline when the shop is closed", async () => {
	const query = vi.fn(async () => [{ id: "first", expiresAt: 11_000 } as Listing]);
	await render(query);
	const invalidate = vi.spyOn(client, "invalidateQueries");
	await act(() => root.unmount());
	await act(async () => {
		await vi.advanceTimersByTimeAsync(2000);
	});
	expect(invalidate).not.toHaveBeenCalled();
	root = createRoot(node);
});
