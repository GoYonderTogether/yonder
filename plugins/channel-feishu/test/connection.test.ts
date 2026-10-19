import * as Lark from "@larksuiteoapi/node-sdk";
import type { PluginAPI } from "@yonder/sdk";
import { createRegistrationCollector } from "@yonder/sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FeishuApi } from "../src/client.js";
import { FeishuConnection } from "../src/connection.js";

afterEach(() => vi.restoreAllMocks());
function setup(onReady = vi.fn()) {
	const api = {
		...createRegistrationCollector().api,
		credentials: { get: async () => ({ type: "api_key", key: "connection-test-secret" }) },
		log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
	} as unknown as PluginAPI;
	const client = new FeishuApi({ appId: "cli_0123456789abcdef", secret: "test" }, api);
	return { api, client, connection: new FeishuConnection("test", client, api, onReady), onReady };
}

describe("Feishu connection lifecycle (official SDK, no model)", () => {
	it("starts SDK without bot/info and leaves initial network retry to SDK", async () => {
		const { client, connection } = setup();
		const info = vi.spyOn(client, "request");
		const endpoint = vi
			.spyOn(Lark.defaultHttpInstance, "request")
			.mockRejectedValue(
				new TypeError("fetch failed", { cause: Object.assign(new Error("DNS unavailable"), { code: "EAI_AGAIN" }) }),
			);
		await connection.start(new Lark.EventDispatcher({}));
		await vi.waitFor(() => expect(endpoint).toHaveBeenCalled());
		expect(info).not.toHaveBeenCalled();
		expect(connection.status().error).toContain("EAI_AGAIN");
		expect(connection.status().sdk?.state).not.toBe("failed");
		connection.stop();
		expect(connection.status()).toEqual({ state: "stopped", error: connection.status().error });
	});
	it("retains platform authentication rejection and stops SDK retries", async () => {
		const { connection } = setup();
		vi.spyOn(Lark.defaultHttpInstance, "request").mockResolvedValue({
			code: 10003,
			data: {},
			msg: "invalid app secret",
		});
		await connection.start(new Lark.EventDispatcher({}));
		await vi.waitFor(() => expect(connection.status().state).toBe("connection-error"));
		expect(connection.status().error).toContain("code=10003");
		expect(connection.status().error).toContain("invalid app secret");
		expect(connection.status().sdk?.state).toBe("failed");
		connection.stop();
	});
	it("does not create a socket when stopped during credential resolution", async () => {
		const { api, connection } = setup();
		let finish!: (value: { type: "api_key"; key: string }) => void;
		api.credentials.get = () =>
			new Promise((resolve) => {
				finish = resolve;
			});
		const start = vi.spyOn(Lark.WSClient.prototype, "start");
		const work = connection.start(new Lark.EventDispatcher({}));
		connection.stop();
		finish({ type: "api_key", key: "connection-test-secret" });
		await work;
		expect(start).not.toHaveBeenCalled();
		expect(connection.status().state).toBe("stopped");
	});
	it("records only safe error fields and scrubs credentials, bearer tokens and URLs", async () => {
		const { client } = setup();
		await client.credentials();
		const error = new Error("connection-test-secret Bearer unknown-token https://host/path?ticket=private", {
			cause: Object.assign(new Error("network down"), {
				code: "ECONNRESET",
				config: { headers: { Authorization: "never serialize" } },
			}),
		});
		const text = client.safe(error);
		expect(text).toContain("ECONNRESET");
		for (const value of ["connection-test-secret", "unknown-token", "private", "never serialize"])
			expect(text).not.toContain(value);
	});
});
