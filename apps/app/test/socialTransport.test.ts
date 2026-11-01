import { afterEach, expect, test, vi } from "vitest";
import { httpApi } from "../src/api/http";

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

test("socket-only reconnect signals HTTP reconciliation, not initial open or cleanup", () => {
	vi.useFakeTimers();
	const sockets: Socket[] = [];
	class Socket {
		onopen = () => {};
		onclose = () => {};
		close() {
			this.onclose();
		}
		constructor() {
			sockets.push(this);
		}
	}
	vi.stubGlobal("WebSocket", Socket);
	vi.stubGlobal("location", { href: "https://yonder.test/c" });
	vi.stubGlobal("window", { setTimeout, clearTimeout });
	const reconcile = vi.fn();
	const stop = httpApi.subscribe(vi.fn(), reconcile);
	sockets[0].onopen();
	expect(reconcile).not.toHaveBeenCalled();
	sockets[0].close();
	vi.advanceTimersByTime(1000);
	sockets[1].onopen();
	expect(reconcile).toHaveBeenCalledTimes(1);
	stop();
	vi.advanceTimersByTime(30_000);
	expect(sockets).toHaveLength(2);
});

test("market preserves cursor, sends server filters and resolves individual missing listings", async () => {
	const fetch = vi
		.fn()
		.mockResolvedValueOnce(new Response(JSON.stringify({ items: [], nextCursor: "opaque+cursor" })))
		.mockResolvedValueOnce(new Response('{"error":"not_found"}', { status: 404 }));
	vi.stubGlobal("fetch", fetch);
	const page = await httpApi.marketListings({
		q: "test & term",
		kind: "service",
		mine: true,
		cursor: "page+2",
		sort: "price_asc",
	});
	expect(page.nextCursor).toBe("opaque+cursor");
	const url = new URL(fetch.mock.calls[0][0], "https://yonder.test");
	expect(Object.fromEntries(url.searchParams)).toEqual({
		q: "test & term",
		kind: "service",
		mine: "1",
		cursor: "page+2",
		sort: "price_asc",
	});
	expect(await httpApi.marketListing("missing")).toBeNull();
	expect(fetch.mock.calls[1][0]).toBe("/api/market/listings/missing");
});
