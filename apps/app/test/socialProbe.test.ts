import { parseHTML } from "linkedom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { probeSocialService } from "../src/lib/useWorkEntry";

/** 网关注入的 <meta name="yonder-base-path"> 决定应用挂载路径（lib/base 的 appBase）。 */
function stubPage(href: string, base?: string): void {
	const meta = base ? `<meta name="yonder-base-path" content="${base}">` : "";
	const { document, window } = parseHTML(`<html><head>${meta}</head><body></body></html>`);
	const url = new URL(href);
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("location", { href, origin: url.origin, pathname: url.pathname, search: "", hash: "" });
}

function stubFetch(statuses: Record<string, number>): ReturnType<typeof vi.fn> {
	const fn = vi.fn(async (input: RequestInfo | URL) => {
		const path = new URL(String(input), "https://host/").pathname;
		return new Response("", { status: statuses[path] ?? 500 });
	});
	vi.stubGlobal("fetch", fn);
	return fn;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("probeSocialService", () => {
	const gateway401 = { "/console/api/rpc/capabilities.get": 401 };

	it("网关挂在 /console/ 而源站根没有社交服务时判定 none，不去探网关自己的端点", async () => {
		stubPage("https://host/console/", "/console/");
		const fetchMock = stubFetch({ ...gateway401, "/console/api/session": 401, "/api/session": 404 });
		await expect(probeSocialService()).resolves.toBe("none");
		expect(fetchMock.mock.calls.map(([input]) => String(input))).toContain("https://host/api/session");
		expect(fetchMock.mock.calls.map(([input]) => String(input))).not.toContain("https://host/console/api/session");
	});

	it("源站根有社交服务时判定 present", async () => {
		stubPage("https://host/console/", "/console/");
		stubFetch({ ...gateway401, "/console/api/session": 401, "/api/session": 200 });
		await expect(probeSocialService()).resolves.toBe("present");
	});

	it("网关本身不可达时不判定 none", async () => {
		stubPage("http://localhost/");
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new TypeError("Failed to fetch");
			}),
		);
		await expect(probeSocialService()).resolves.toBe("present");
	});
});
