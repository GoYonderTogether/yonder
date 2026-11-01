import { afterEach, describe, expect, it, vi } from "vitest";
import type { ListingInput } from "../src/api/client";
import { httpApi } from "../src/api/http";

const input: ListingInput = {
	kind: "item",
	category: "数码好物",
	title: "标题",
	description: "说明",
	price: 1,
	unit: "",
	location: "",
	delivery: "面交",
	images: [],
	sellerRole: "个人",
	discoverable: true,
	agent: false,
	tags: [],
	facts: [],
	missing: [],
	visibility: "private",
	expiresAt: null,
	coordinates: null,
};
const cloud = {
	...input,
	id: "post-id",
	sellerId: "seller-id",
	seller: "卖家",
	mine: true,
	status: "active",
	createdAt: 1,
	updatedAt: 1,
	metrics: { shortlists: 0 },
};
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});
it("preserves real seller and policy fields and sends server-side shop pagination filters", async () => {
	const fetch = vi
		.fn()
		.mockResolvedValueOnce(response({ listingPolicy: true, sellerShops: true }))
		.mockResolvedValueOnce(response({ items: [cloud], nextCursor: "next" }));
	vi.stubGlobal("fetch", fetch);
	const page = await httpApi.marketListings({ sellerId: "seller-id", cursor: "page-2" });
	expect(fetch.mock.calls[0]).toEqual(["/api/market/capabilities", expect.objectContaining({ cache: "no-store" })]);
	const url = new URL(fetch.mock.calls[1][0], "https://host.invalid");
	expect(url.searchParams.get("sellerId")).toBe("seller-id");
	expect(url.searchParams.get("cursor")).toBe("page-2");
	expect(page.items[0]).toMatchObject({
		sellerId: "seller-id",
		visibility: "private",
		expiresAt: null,
		coordinates: null,
	});
	expect(page.nextCursor).toBe("next");
});
describe("fail closed on legacy markets", () => {
	it.each([404, false, "true", undefined])("does not create a private post when support is %s", async (value) => {
		const fetch = vi
			.fn()
			.mockResolvedValue(
				response(
					value === 404 ? { error: "not_found" } : { listingPolicy: value, sellerShops: true },
					value === 404 ? 404 : 200,
				),
			);
		vi.stubGlobal("fetch", fetch);
		await expect(httpApi.createListing(input)).rejects.toThrow("市场服务正在更新");
		expect(fetch).toHaveBeenCalledOnce();
		expect(fetch.mock.calls[0][1].method).not.toBe("POST");
	});
	it("does not fall back to the general feed when seller filter support is missing", async () => {
		const fetch = vi.fn().mockResolvedValue(response({ listingPolicy: true, sellerShops: false }));
		vi.stubGlobal("fetch", fetch);
		await expect(httpApi.marketListings({ sellerId: "seller-id" })).rejects.toThrow("市场服务正在更新");
		expect(fetch).toHaveBeenCalledOnce();
	});
	it("checks support again before each write and sends real DELETE without a request body", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(response({ listingPolicy: true }))
			.mockResolvedValueOnce(response(cloud))
			.mockResolvedValueOnce(response({ listingPolicy: true }))
			.mockResolvedValueOnce(new Response(null, { status: 204 }));
		vi.stubGlobal("fetch", fetch);
		await httpApi.updateListing("a/b", { visibility: "friends" });
		await httpApi.deleteListing("a/b");
		expect(fetch.mock.calls.map(([url, init]) => [url, init.method ?? "GET"])).toEqual([
			["/api/market/capabilities", "GET"],
			["/api/market/listings/a%2Fb", "PATCH"],
			["/api/market/capabilities", "GET"],
			["/api/market/listings/a%2Fb", "DELETE"],
		]);
		expect(fetch.mock.calls[3][1].body).toBeUndefined();
	});
	it.each(["delete", "patch"] as const)("blocks %s without policy support", async (action) => {
		const fetch = vi.fn().mockResolvedValue(response({ listingPolicy: false }));
		vi.stubGlobal("fetch", fetch);
		const task =
			action === "delete" ? httpApi.deleteListing("p") : httpApi.updateListing("p", { visibility: "friends" });
		await expect(task).rejects.toThrow("市场服务正在更新");
		expect(fetch).toHaveBeenCalledOnce();
	});
});

it("reports 404 or malformed capability flags as unsupported but keeps network failures explicit", async () => {
	const fetch = vi
		.fn()
		.mockResolvedValueOnce(response({ error: "not_found" }, 404))
		.mockResolvedValueOnce(response({ listingPolicy: "true", sellerShops: false }))
		.mockRejectedValueOnce(new Error("offline"));
	vi.stubGlobal("fetch", fetch);
	await expect(httpApi.marketCapabilities()).resolves.toEqual({ listingPolicy: false, sellerShops: false });
	await expect(httpApi.marketCapabilities()).resolves.toEqual({ listingPolicy: false, sellerShops: false });
	await expect(httpApi.marketCapabilities()).rejects.toThrow("offline");
});
it("keeps ordinary legacy public publication and editing while stripping unsupported default policy fields", async () => {
	const ordinary = { ...input, visibility: "public" as const, location: "线上" };
	const fetch = vi
		.fn()
		.mockResolvedValueOnce(response({ error: "not_found" }, 404))
		.mockResolvedValueOnce(response({ ...cloud, ...ordinary }))
		.mockResolvedValueOnce(response({ listingPolicy: false }))
		.mockResolvedValueOnce(response({ ...cloud, ...ordinary }));
	vi.stubGlobal("fetch", fetch);
	await httpApi.createListing(ordinary);
	await httpApi.updateListing("post-id", {
		title: "修改",
		location: "线上",
		visibility: "public",
		expiresAt: null,
		coordinates: null,
	});
	for (const index of [1, 3]) {
		const body = JSON.parse(fetch.mock.calls[index][1].body);
		expect(body).not.toHaveProperty("visibility");
		expect(body).not.toHaveProperty("expiresAt");
		expect(body).not.toHaveProperty("coordinates");
		expect(body.location).toBe("线上");
	}
	expect(fetch.mock.calls[1][1].method).toBe("POST");
	expect(fetch.mock.calls[3][1].method).toBe("PATCH");
});
it.each([
	{ visibility: "friends" },
	{ visibility: "private" },
	{ expiresAt: 123456 },
	{ coordinates: { latitude: 31, longitude: 121 } },
])("never silently drops requested new policy values %j", async (policy) => {
	const fetch = vi.fn().mockResolvedValue(response({ error: "not_found" }, 404));
	vi.stubGlobal("fetch", fetch);
	await expect(httpApi.updateListing("post-id", policy as never)).rejects.toThrow("未保存");
	expect(fetch).toHaveBeenCalledOnce();
});
it("requires an honest manual location on old backends", async () => {
	const fetch = vi.fn().mockResolvedValue(response({ error: "not_found" }, 404));
	vi.stubGlobal("fetch", fetch);
	await expect(httpApi.createListing({ ...input, visibility: "public" })).rejects.toThrow("请填写地点");
	expect(fetch).toHaveBeenCalledOnce();
});
it("allows existing pause and resume endpoints without any capability preflight", async () => {
	const fetch = vi.fn().mockImplementation(async () => response(cloud));
	vi.stubGlobal("fetch", fetch);
	await httpApi.setListingPaused("post-id", true);
	await httpApi.setListingPaused("post-id", false);
	expect(fetch.mock.calls.map(([url]) => url)).toEqual([
		"/api/market/listings/post-id/pause",
		"/api/market/listings/post-id/resume",
	]);
});
it("keeps supported policy fields unchanged on new backends", async () => {
	const next = { ...input, expiresAt: 123456, coordinates: { latitude: 31.123, longitude: 121.123 } };
	const fetch = vi
		.fn()
		.mockResolvedValueOnce(response({ listingPolicy: true, sellerShops: true }))
		.mockResolvedValueOnce(response({ ...cloud, ...next }));
	vi.stubGlobal("fetch", fetch);
	await httpApi.createListing(next);
	expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({
		visibility: "private",
		expiresAt: 123456,
		coordinates: next.coordinates,
	});
});
