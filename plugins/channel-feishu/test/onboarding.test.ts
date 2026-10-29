import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { PluginAPI } from "@yonder/sdk";
import { createRegistrationCollector } from "@yonder/sdk/testing";
import { afterEach, expect, test, vi } from "vitest";
import type { FeishuChannel } from "../src/channel.js";
import plugin from "../src/index.js";
import { CALLBACKS, EVENTS, TENANT_SCOPES, USER_SCOPES } from "../src/onboarding.js";

afterEach(() => vi.unstubAllGlobals());
const reply = (body: object, status = 200) => new Response(JSON.stringify(body), { status });
const decode = (value: string) =>
	JSON.parse(gunzipSync(Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64")).toString("utf8"));

async function setup(polls: object[], existing?: string) {
	const collector = createRegistrationCollector();
	const data = existing ?? (await mkdtemp(join(tmpdir(), "feishu-onboarding-")));
	const api = {
		...collector.api,
		paths: { data },
		credentials: { get: async () => undefined },
	} as unknown as PluginAPI;
	await plugin.setup(api);
	const forms: URLSearchParams[] = [];
	vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
		const form = new URLSearchParams(String(init?.body));
		forms.push(form);
		if (form.get("action") === "begin")
			return reply({
				device_code: "dev-code",
				user_code: "ABCD-EFGH",
				verification_uri_complete: "https://open.feishu.cn/page/launcher?user_code=ABCD-EFGH",
				expires_in: 600,
				interval: 5,
			});
		return reply(polls.shift() ?? { error: "authorization_pending" }, 400);
	});
	const provider = collector.registrations.channels[0]!;
	const create = () => provider.create("a", {}) as FeishuChannel;
	return { create, data, forms, signal: new AbortController().signal };
}

test("permission list covers send, history, groups, resources, cards and docs", () => {
	for (const name of [
		"im:message:send_as_bot",
		"im:resource",
		"cardkit:card:write",
		"im:chat:read",
		"docx:document:readonly",
	])
		expect(TENANT_SCOPES).toContain(name);
	expect(USER_SCOPES).toContain("im:message.group_msg:get_as_user");
});

test("start returns one PersonalAgent creation link carrying every scope", async () => {
	const { create, forms, signal } = await setup([]);
	const channel = create();
	const result = await channel.login("start", signal);
	expect(forms[0]!.get("archetype")).toBe("PersonalAgent");
	expect(result.status).toBe("wait");
	const url = new URL(result.qrcodeUrl!);
	expect(url.searchParams.get("createOnly")).toBe("true");
	expect(url.searchParams.get("user_code")).toBe("ABCD-EFGH");
	const addons = decode(url.searchParams.get("addons")!);
	expect(addons.scopes).toEqual({ tenant: TENANT_SCOPES, user: USER_SCOPES });
	expect(addons.events.items.tenant).toEqual(EVENTS);
	expect(addons.callbacks.items).toEqual(CALLBACKS);
	expect(channel.status()).toMatchObject({ configured: false });
	await channel.stop();
});

test("confirmed registration stores credentials privately and never returns the secret", async () => {
	const { create, data, signal } = await setup([
		{ error: "authorization_pending" },
		{ client_id: "cli_new", client_secret: "new-secret-value", user_info: { open_id: "ou_1", tenant_brand: "feishu" } },
	]);
	const channel = create();
	await channel.login("start", signal);
	expect((await channel.login("poll", signal)).status).toBe("wait");
	const done = await channel.login("poll", signal);
	expect(done).toEqual({ status: "confirmed", instance: "a" });
	expect(JSON.stringify(done)).not.toContain("new-secret-value");
	const file = join(data, "a", "app.json");
	expect((await stat(file)).mode & 0o777).toBe(0o600);
	expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({ appId: "cli_new", appSecret: "new-secret-value" });
	expect((await channel.login("start", signal)).status).toBe("already_configured");
	await channel.stop();
	// A restarted instance picks the stored app up without any config.
	const again = (await setup([], data)).create();
	expect(again.status()).toMatchObject({ configured: true });
	expect(await again.client.credentials()).toEqual({ appId: "cli_new", appSecret: "new-secret-value" });
	await again.stop();
});

test("denied registration reports status without saving credentials", async () => {
	const { create, signal } = await setup([{ error: "access_denied" }]);
	const channel = create();
	await channel.login("start", signal);
	expect((await channel.login("poll", signal)).status).toBe("denied");
	expect(channel.status()).toMatchObject({ configured: false });
	await channel.stop();
});
