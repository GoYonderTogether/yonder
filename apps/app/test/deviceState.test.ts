import { describe, expect, it } from "vitest";
import {
	activeGrant,
	BOT_DEVICE_WORD,
	botDeviceState,
	deviceState,
	lastActivity,
	relativeTime,
} from "../src/components/devices/state";

describe("设备状态词", () => {
	it("keeps online, stale, cached and offline apart", () => {
		expect(deviceState({ online: true, workProtocol: 1 }, false)).toBe("online");
		expect(deviceState({ online: true }, false)).toBe("stale");
		expect(deviceState({ online: false }, true)).toBe("cached");
		expect(deviceState({ online: false }, false)).toBe("offline");
	});

	it("never invents a time for a device that has not reported one", () => {
		expect(relativeTime(undefined)).toBeUndefined();
		expect(relativeTime("not a date")).toBeUndefined();
		expect(relativeTime(new Date().toISOString())).toBe("刚刚");
	});

	it("prefers real activity over a bare connection", () => {
		const now = Date.parse("2026-11-04T12:00:00Z");
		expect(lastActivity({}, now)).toBeUndefined();
		expect(lastActivity({ lastSeenAt: "2026-11-04T11:00:00Z" }, now)?.label).toBe("上次连接 1 小时前");
		expect(lastActivity({ lastSeenAt: "2026-11-04T11:00:00Z", lastActiveAt: "2026-11-04T11:59:00Z" }, now)?.label).toBe(
			"最近活动 1 分钟前",
		);
	});

	it("distinguishes an unreported device from a device with no grant", () => {
		expect(botDeviceState({ allowed: false, online: true, observed: true, hasGrant: true })).toBe("not-allowed");
		expect(botDeviceState({ allowed: true, online: false, observed: true, hasGrant: true })).toBe("offline");
		expect(botDeviceState({ allowed: true, online: true, observed: false, hasGrant: false })).toBe("unreported");
		expect(botDeviceState({ allowed: true, online: true, observed: true, hasGrant: false })).toBe("no-grant");
		expect(botDeviceState({ allowed: true, online: true, observed: true, hasGrant: true })).toBe("ready");
		// The four words must stay distinct in the UI.
		expect(new Set(Object.values(BOT_DEVICE_WORD)).size).toBe(5);
	});

	it("counts a grant only while it is live for that Bot", () => {
		const now = Date.parse("2026-11-04T12:00:00Z");
		const grant = {
			grantId: "g",
			principalId: "p",
			botId: "bot",
			botLabel: null,
			source: "cloud" as const,
			capabilities: ["read"],
			targetIds: [],
			readRoots: [],
			writeRoots: [],
			revision: 1,
			issuedAt: "2026-11-04T11:00:00Z",
			expiresAt: "2026-11-05T11:00:00Z",
			revokedAt: null,
		};
		expect(activeGrant(grant, "bot", now)).toBe(true);
		expect(activeGrant(grant, "other", now)).toBe(false);
		expect(activeGrant({ ...grant, revokedAt: "2026-11-04T11:30:00Z" }, "bot", now)).toBe(false);
		expect(activeGrant({ ...grant, expiresAt: "2026-11-04T11:30:00Z" }, "bot", now)).toBe(false);
	});
});
