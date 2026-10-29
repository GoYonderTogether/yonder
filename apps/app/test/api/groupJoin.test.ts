import { afterEach, describe, expect, it, vi } from "vitest";
import { httpApi } from "../../src/api/http";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("httpApi.joinGroup", () => {
	it("forwards the share token so the server can check revocation, expiry and quota", async () => {
		const fetchMock = vi.fn().mockImplementation(async () => new Response("{}"));
		vi.stubGlobal("fetch", fetchMock);
		await httpApi.joinGroup("tok/1", "sh are");
		await httpApi.joinGroup("tok/1");
		expect(fetchMock.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
			["/api/groups/tok%2F1/join?share=sh%20are", "POST"],
			["/api/groups/tok%2F1/join", "POST"],
		]);
	});
});
