import { parseHTML } from "linkedom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gatewayHosted } from "../src/lib/base";

afterEach(() => vi.unstubAllGlobals());

describe("gatewayHosted", () => {
	it("只有网关注入 yonder-base-path 才算网关托管（云端静态站不是）", () => {
		vi.stubGlobal("document", parseHTML("<html><head></head><body></body></html>").document);
		expect(gatewayHosted()).toBe(false);
		vi.stubGlobal(
			"document",
			parseHTML('<html><head><meta name="yonder-base-path" content="/console/"></head><body></body></html>').document,
		);
		expect(gatewayHosted()).toBe(true);
	});
});
