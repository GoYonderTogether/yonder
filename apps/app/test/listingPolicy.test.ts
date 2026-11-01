import { describe, expect, it } from "vitest";
import {
	approximateCoordinates,
	isExpired,
	listingInput,
	listingTab,
	locationLabel,
	selectedExpiry,
} from "../src/market/listingPolicy";
import type { Listing } from "../src/market/types";

const listing: Listing = {
	id: "post",
	kind: "item",
	category: "数码好物",
	title: "标题",
	description: "说明",
	price: 1,
	unit: "",
	location: "",
	delivery: "面交",
	image: "",
	seller: "名字",
	sellerRole: "个人",
	tags: [],
	facts: [],
	missing: [],
	agent: false,
	mine: true,
	createdAt: 1,
	metrics: { agentViews: 0, humanViews: 0, shortlists: 0, inquiries: 0 },
};
describe("listing policy", () => {
	it("does not reset an existing expiry while editing another field", () => {
		const old = { ...listing, expiresAt: 50 };
		expect(selectedExpiry("keep", old.expiresAt, 100)).toBe(50);
		expect(listingInput({ ...old, title: "修改后" }, old)).not.toHaveProperty("expiresAt");
	});
	it("sends explicit renewal or long-lived reset and preserves visibility and coordinates", () => {
		const expiresAt = selectedExpiry("3", 50, 100);
		expect(expiresAt).toBe(100 + 3 * 86400_000);
		const old = { ...listing, expiresAt: 50 };
		expect(
			listingInput(
				{ ...old, expiresAt: null, visibility: "friends", coordinates: { latitude: 31, longitude: 121 } },
				old,
			),
		).toMatchObject({ expiresAt: null, visibility: "friends", coordinates: { latitude: 31, longitude: 121 } });
		expect(selectedExpiry("forever", 50)).toBeNull();
		expect(() => selectedExpiry("5")).toThrow();
	});
	it("groups every expired listing under hidden instead of a separate expiry tab", () => {
		expect(listingTab({ paused: true, expiresAt: 10 }, 20)).toBe("paused");
		expect(listingTab({ paused: false, expiresAt: 10 }, 20)).toBe("paused");
		expect(listingTab({ expiresAt: null }, 20)).toBe("active");
		expect(isExpired({ expiresAt: 20 }, 20)).toBe(true);
	});
	it("keeps no-location publishing honest and only rounds real coordinates", () => {
		expect(locationLabel({ location: "", coordinates: null })).toBe("未附地点 / 线上");
		expect(locationLabel({ location: "", coordinates: { latitude: 31, longitude: 121 } })).toBe("已附定位");
		expect(approximateCoordinates(31.123456, 121.987654)).toEqual({ latitude: 31.123, longitude: 121.988 });
		expect(() => approximateCoordinates(NaN, 121)).toThrow();
		expect(() => approximateCoordinates(91, 121)).toThrow();
	});
});
