import { expect, test } from "vitest";
import { openDatabase } from "../runtime/db.js";
import { createQuota, guestLimitDefaults, type OutsiderSubject, quotaDay } from "./quota.js";

const guest = (qr: string, source: string): OutsiderSubject => ({ kind: "guest", qr, source });
const person = (id: string): OutsiderSubject => ({ kind: "person", person: id });

async function ledger(outsiders: Parameters<typeof createQuota>[0]["outsiders"], now?: () => number) {
	const db = await openDatabase(":memory:");
	const quota = createQuota({
		db,
		outsiders,
		timezone: "Asia/Shanghai",
		...(now ? { now } : {}),
	});
	return { db, quota };
}

test("访客第 4 轮被拒，并提示登录", async () => {
	const { db, quota } = await ledger({ guestMaxRounds: 3 });
	try {
		for (let round = 1; round <= 3; round++) {
			expect(await quota.remaining(guest("qr-1", "dev-1"))).toEqual({ ok: true, remaining: expect.any(Number) });
			await quota.charge(guest("qr-1", "dev-1"), 1000, 1);
		}
		expect(await quota.guestRounds({ qr: "qr-1", source: "dev-1" })).toBe(3);
		const denied = await quota.remaining(guest("qr-1", "dev-1"));
		expect(denied).toMatchObject({ ok: false, reason: "guest_rounds" });
		expect(denied.ok === false && denied.message).toContain("登录");
	} finally {
		await db.close();
	}
});

test("登录外人按每人每日 300 万封顶", async () => {
	const { db, quota } = await ledger({ perPersonDailyTokens: 3_000_000, ownerShareDailyTokens: "10M" });
	try {
		await quota.charge(person("person:alice"), 3_000_000);
		expect(await quota.remaining(person("person:alice"))).toMatchObject({ ok: false, reason: "person_daily_limit" });
		// 另一个登录的人不受影响：池子还够。
		expect(await quota.remaining(person("person:bob"))).toEqual({ ok: true, remaining: 3_000_000 });
	} finally {
		await db.close();
	}
});

test("主人分享池耗尽后所有外人被拒", async () => {
	const { db, quota } = await ledger({ ownerShareDailyTokens: 500_000 });
	try {
		await quota.charge(person("person:alice"), 500_000);
		expect(await quota.remaining(person("person:alice"))).toMatchObject({ ok: false, reason: "owner_share_exhausted" });
		expect(await quota.remaining(person("person:bob"))).toMatchObject({ ok: false, reason: "owner_share_exhausted" });
		expect(await quota.remaining(guest("qr-1", "dev-9"))).toMatchObject({
			ok: false,
			reason: "owner_share_exhausted",
		});
	} finally {
		await db.close();
	}
});

test("同一来源批量换访客身份被来源轮数挡住", async () => {
	const { db, quota } = await ledger({ guestMaxRounds: 3 });
	try {
		for (const qr of ["qr-a", "qr-b"]) {
			for (let round = 1; round <= 3; round++) {
				expect(await quota.remaining(guest(qr, "dev-1"))).toMatchObject({ ok: true });
				await quota.charge(guest(qr, "dev-1"), 500, 1);
			}
		}
		// 第三个身份还是同一台设备：来源轮数（缺省 6 轮）已经用完。
		const denied = await quota.remaining(guest("qr-c", "dev-1"));
		expect(denied).toMatchObject({ ok: false, reason: "guest_source_rounds" });
		// 换一台设备仍可访客对话，说明挡住的是来源而不是二维码。
		expect(await quota.remaining(guest("qr-c", "dev-2"))).toMatchObject({ ok: true });
	} finally {
		await db.close();
	}
});

test("访客额度按二维码封顶，且访客消耗同样计入主人池", async () => {
	const { db, quota } = await ledger({ guestPerQrDailyTokens: 2000, ownerShareDailyTokens: 5000 });
	try {
		await quota.charge(guest("qr-1", "dev-1"), 1000, 1);
		await quota.charge(guest("qr-1", "dev-2"), 1000, 1);
		// 二维码自己封顶了，换设备也进不来。
		expect(await quota.remaining(guest("qr-1", "dev-3"))).toMatchObject({ ok: false, reason: "guest_qr_tokens" });
		// 另一张二维码自己的上限还是 2000，主人池只剩 3000。
		expect(await quota.remaining(guest("qr-2", "dev-3"))).toEqual({ ok: true, remaining: 2000 });
		await quota.charge(guest("qr-2", "dev-3"), 2000, 1);
		expect(await quota.remaining(guest("qr-3", "dev-4"))).toEqual({ ok: true, remaining: 1000 });
		await quota.charge(guest("qr-3", "dev-4"), 1000, 1);
		expect(await quota.remaining(guest("qr-4", "dev-5"))).toMatchObject({
			ok: false,
			reason: "owner_share_exhausted",
		});
	} finally {
		await db.close();
	}
});

test("未登录绝不计入个人额度，关掉 requireLoginForQuota 才按每人上限封顶", async () => {
	const strict = await ledger({ perPersonDailyTokens: 1000, requireLoginForQuota: true });
	try {
		await strict.quota.charge(guest("qr-1", "dev-1"), 5000, 1);
		expect(await strict.quota.remaining(person("person:alice"))).toEqual({ ok: true, remaining: 1000 });
	} finally {
		await strict.db.close();
	}
	const loose = await ledger({ perPersonDailyTokens: 1000, requireLoginForQuota: false });
	try {
		await loose.quota.charge(guest("qr-1", "dev-1"), 1000, 1);
		expect(await loose.quota.remaining(guest("qr-2", "dev-1"))).toMatchObject({
			ok: false,
			reason: "person_daily_limit",
		});
	} finally {
		await loose.db.close();
	}
});

test("日界线按主人时区，第二天额度重新开始", async () => {
	expect(quotaDay(Date.parse("2026-10-29T15:59:00Z"), "Asia/Shanghai")).toBe("2026-10-29");
	expect(quotaDay(Date.parse("2026-10-29T16:01:00Z"), "Asia/Shanghai")).toBe("2026-10-30");
	expect(quotaDay(Date.parse("2026-10-29T15:59:00Z"), "UTC")).toBe("2026-10-29");

	let clock = Date.parse("2026-10-29T03:00:00Z");
	const { db, quota } = await ledger({ guestMaxRounds: 1 }, () => clock);
	try {
		await quota.charge(guest("qr-1", "dev-1"), 100, 1);
		expect(await quota.remaining(guest("qr-1", "dev-1"))).toMatchObject({ ok: false, reason: "guest_rounds" });
		clock = Date.parse("2026-10-30T03:00:00Z");
		expect(await quota.remaining(guest("qr-1", "dev-1"))).toMatchObject({ ok: true });
		expect(await quota.guestRounds({ qr: "qr-1", source: "dev-1" })).toBe(0);
	} finally {
		await db.close();
	}
});

test("缺省防批量上限有值，二维码上限不高于缺省分享池", async () => {
	expect(guestLimitDefaults.perSourceDailyRounds).toBeGreaterThan(3);
	expect(guestLimitDefaults.perQrDailyTokens).toBeLessThanOrEqual(500_000);
	const { db, quota } = await ledger({});
	try {
		// 不配 guestPerQrDailyTokens 时，缺省上限生效：越过它就按二维码拒绝。
		await quota.charge(guest("qr-1", "dev-1"), guestLimitDefaults.perQrDailyTokens, 1);
		expect(await quota.remaining(guest("qr-1", "dev-2"))).toMatchObject({ ok: false, reason: "guest_qr_tokens" });
	} finally {
		await db.close();
	}
});
