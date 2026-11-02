import { expect, test } from "vitest";
import { servicePlist } from "./launchers.js";
import { serviceNetworkEnvironment } from "./service-network.js";

test("service proxy configuration survives reinstall without capturing other environment secrets", () => {
	const existing = {
		https_proxy: "http://127.0.0.1:7897",
		NO_PROXY: "localhost,127.0.0.1",
		NODE_USE_ENV_PROXY: "1",
		OPENAI_API_KEY: "not-copied",
	};
	const inherited = {
		HTTPS_PROXY: "http://different.invalid",
		HTTP_PROXY: "http://127.0.0.1:7897",
		NODE_USE_ENV_PROXY: "0",
		NODE_OPTIONS: "not-copied",
	};
	const environment = serviceNetworkEnvironment(existing, inherited);
	expect(environment).toEqual({
		https_proxy: existing.https_proxy,
		HTTP_PROXY: inherited.HTTP_PROXY,
		NO_PROXY: existing.NO_PROXY,
		NODE_USE_ENV_PROXY: "1",
	});
	expect(serviceNetworkEnvironment(environment, {})).toEqual(environment);
	const plist = servicePlist("/install", "/home", "/bin", true, environment);
	expect(plist).toContain("<key>NODE_USE_ENV_PROXY</key><string>1</string>");
	expect(plist).toContain("<key>https_proxy</key><string>http://127.0.0.1:7897</string>");
	expect(plist).not.toContain("not-copied");
	expect(servicePlist("/install", "/home", "/bin")).not.toContain("PROXY");
});
