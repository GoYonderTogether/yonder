import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Limiter, Sessions, Tickets, tokenHash } from "../src/auth.js";
import { Feed, RING_BYTES } from "../src/stream.js";

describe("auth", () => {
	it("tickets are single use", () => {
		const tickets = new Tickets();
		const { token } = tickets.issue();
		expect(tickets.consume(token)).toBe(true);
		expect(tickets.consume(token)).toBe(false);
		expect(tickets.consume("other")).toBe(false);
	});
	it("remote cookies die when the access token hash changes", async () => {
		const sessions = await Sessions.open(await mkdtemp(join(tmpdir(), "gw-")));
		const hash = tokenHash("a");
		const cookie = sessions.sign("remote", hash);
		expect(sessions.verify(cookie, hash)).toBe("remote");
		expect(sessions.verify(cookie, tokenHash("b"))).toBeUndefined();
		expect(sessions.verify(`${cookie}x`, hash)).toBeUndefined();
		expect(sessions.verify(sessions.sign("local"), undefined)).toBe("local");
	});
	it("exposes the cookie expiry and honours a custom lifetime", async () => {
		const sessions = await Sessions.open(await mkdtemp(join(tmpdir(), "gw-")));
		const before = Date.now();
		const info = sessions.inspect(sessions.sign("local", undefined, 5000), undefined);
		expect(info?.login).toBe("local");
		expect(info?.exp).toBeGreaterThanOrEqual(before + 5000);
		expect(sessions.inspect(sessions.sign("local", undefined, -1), undefined)).toBeUndefined();
	});
	it("bounds the number of remembered failure keys", () => {
		const limiter = new Limiter(1, 60_000, 3);
		for (const key of ["a", "b", "c", "d"]) limiter.fail(key);
		expect(limiter.blocked("a")).toBe(false);
		expect(limiter.blocked("d")).toBe(true);
	});
	it("limits repeated failures", () => {
		const limiter = new Limiter(2, 1000);
		limiter.fail("k");
		expect(limiter.blocked("k")).toBe(false);
		limiter.fail("k");
		expect(limiter.blocked("k")).toBe(true);
	});
});

describe("feed resume", () => {
	const feed = new Feed("k", "sessions.watch", true, () => {});
	for (const n of [1, 2, 3]) feed.publish({ n });
	it("replays events after a cursor from the same epoch", () => {
		expect(feed.replay(`${feed.epoch}:1`)?.map((e) => e.seq)).toEqual([2, 3]);
		expect(feed.replay(`${feed.epoch}:3`)).toEqual([]);
	});
	it("reports a gap for foreign epochs and cursors from the future", () => {
		expect(feed.replay("other:1")).toBeUndefined();
		expect(feed.replay(`${feed.epoch}:99`)).toBeUndefined();
	});
	it("reports a gap once the ring has dropped the needed events", () => {
		const long = new Feed("k2", "sessions.watch", true, () => {});
		for (let n = 0; n < 2100; n++) long.publish(n);
		expect(long.replay(`${long.epoch}:5`)).toBeUndefined();
		expect(long.replay(`${long.epoch}:2095`)?.length).toBe(5);
	});
	it("bounds the ring by bytes and then reports a gap for the dropped range", () => {
		const big = new Feed("k3", "sessions.watch", true, () => {});
		const chunk = "x".repeat(Math.floor(RING_BYTES / 4));
		for (let n = 0; n < 6; n++) big.publish(chunk);
		expect(big.ring.length).toBeLessThanOrEqual(4);
		expect(big.replay(`${big.epoch}:1`)).toBeUndefined();
		expect(big.replay(`${big.epoch}:${big.seq - 1}`)?.length).toBe(1);
	});
});
