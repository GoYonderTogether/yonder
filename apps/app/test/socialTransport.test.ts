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
