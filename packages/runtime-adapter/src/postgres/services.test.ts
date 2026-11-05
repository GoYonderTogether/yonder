import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { expect, test } from "vitest";

// 与 postgres/storage.test.ts 相同的跨包测试基建引用方式。
const { testPostgres, testPostgresUnavailable } = await import(
	new URL("../../../cloud-host/src/test-postgres.ts", import.meta.url).href
);

import { createPostgresRuntimeServices, parsePlatformModel } from "./services.js";

test("platform model parses bare ids onto the default provider and provider-qualified refs as written", () => {
	expect(parsePlatformModel("deepseek-flash")).toEqual({ provider: "deepseek", model: "deepseek-flash" });
	expect(parsePlatformModel("zai/glm-5.3-flash")).toEqual({ provider: "zai", model: "glm-5.3-flash" });
	expect(() => parsePlatformModel("a/b/c")).toThrow("provider/model");
});

test.skipIf(testPostgresUnavailable)(
	"the platform provider comes from config: a custom OpenAI-compatible provider resolves from the same catalog",
	async () => {
		const providerId = "zai";
		const catalog = builtinProviders().find((provider) => provider.id === providerId);
		expect(catalog?.getModels().some((model) => model.id === "glm-5.3-flash")).toBe(true);
		const host = await createPostgresRuntimeServices({
			pool: (await testPostgres()).pool,
			apiKey: "transport-test-only",
			baseUrl: "https://api.example/v1",
			model: "zai/glm-5.3-flash",
		});
		try {
			const services = host.forBot("tenant-a", "bot-a");
			expect(services.models.getProviders().map((provider) => provider.id)).toEqual([providerId]);
			expect(services.models.getModels().map((model) => model.id)).toEqual(["glm-5.3-flash"]);
			// 请求整形与成本沿用目录里的真实定义，不因换 baseUrl 丢失。
			const model = services.models.getModel(providerId, "glm-5.3-flash");
			expect((model?.compat as { thinkingFormat?: string } | undefined)?.thinkingFormat).toBe("zai");
			expect(model?.cost.input).toBeGreaterThan(0);
		} finally {
			await host.close();
		}
	},
	60000,
);
