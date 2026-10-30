import { describe, expect, it } from "vitest";
import { parseWork, workPath } from "../src/work/shell/workRoutes";

/**
 * 工作区路由只区分「功能页」和「会话」两类：任何非页面名的段都当会话 id。
 * /work/999、/work/new 因此会进入会话视图，由 sessions.show 的 not_found 变成「找不到这个会话」——
 * 这里把这个前提钉住，别让路由层悄悄把未知 id 当成别的状态。
 */
describe("parseWork", () => {
	it("keeps the device when session identifiers collide", () => {
		expect(parseWork("/work/device/phone/42")).toEqual({ deviceId: "phone", session: "42" });
		expect(parseWork("/work/device/laptop/42")).toEqual({ deviceId: "laptop", session: "42" });
		expect(workPath({ deviceId: "phone", session: "42" })).toBe("/work/device/phone/42");
	});
	it("treats the three feature pages as pages", () => {
		expect(parseWork("/work/console")).toEqual({ page: "console" });
		expect(parseWork("/work/market")).toEqual({ page: "market" });
		expect(parseWork("/work/settings")).toEqual({ page: "settings" });
	});

	it("treats any other segment as a session id, including ids that do not exist", () => {
		expect(parseWork("/work/999")).toEqual({ session: "999" });
		expect(parseWork("/work/new")).toEqual({ session: "new" });
		expect(parseWork("/work/import")).toEqual({ session: "import" });
		// 会话 id 之外的段（/work/a/b）忽略，只取第一段
		expect(parseWork("/work/task-1/panel")).toEqual({ session: "task-1" });
	});

	it("returns an empty route for the list itself", () => {
		expect(parseWork("/work")).toEqual({});
		expect(parseWork("/work/")).toEqual({});
	});

	it("decodes ids and falls back to no route on a broken escape", () => {
		expect(parseWork("/work/a%20b")).toEqual({ session: "a b" });
		expect(parseWork("/work/%E0%A4%A")).toEqual({});
	});
});

describe("workPath", () => {
	it("round-trips with parseWork", () => {
		expect(workPath()).toBe("/work");
		expect(workPath({ page: "console" })).toBe("/work/console");
		expect(parseWork(workPath({ session: "a b" }))).toEqual({ session: "a b" });
	});
});
