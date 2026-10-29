import { afterEach, describe, expect, it, vi } from "vitest";
import { profileRoute } from "../src/lib/profileRoute";

/** 模拟网关注入的 <meta name="yonder-base-path">；不给 base 时 appBase 回退 BASE_URL（测试下为 "/"）。 */
function stubPage(base?: string): void {
	vi.stubGlobal("document", { querySelector: () => (base ? { getAttribute: () => base } : null) });
	vi.stubGlobal("location", { origin: "https://host" });
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("profileRoute", () => {
	it("接受根路径下的名片/主页链接并保留查询", () => {
		stubPage();
		expect(profileRoute("https://host/u/123")).toBe("/u/123");
		expect(profileRoute("/p/a~b?x=1")).toBe("/p/a~b?x=1");
	});

	it("接受网关托管下带 base 的链接，返回不带 base 的路由", () => {
		stubPage("/console/");
		expect(profileRoute("https://host/console/u/123")).toBe("/u/123");
		expect(profileRoute("https://host/console/p/a~b")).toBe("/p/a~b");
		expect(profileRoute("https://host/console/u/123?s=scan", "scan")).toBe("/u/123?s=scan");
	});

	it("把裸码当主页码，拒绝其他路径", () => {
		stubPage();
		expect(profileRoute("abc123")).toBe("/p/abc123");
		expect(profileRoute("https://host/c/1")).toBeUndefined();
		expect(profileRoute("https://host/console/cards")).toBeUndefined();
	});
});
