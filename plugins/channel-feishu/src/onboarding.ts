import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { object, string } from "./protocol.js";

/**
 * Permissions requested when Feishu creates the app. Taken from the 85 scopes of the production Yonder app,
 * minus mail:* (not used by the channel). Unknown names are silently dropped by the confirmation page,
 * so the list is safe to keep ahead of the platform catalog.
 */
export const TENANT_SCOPES = [
	"application:app_slash_command:read",
	"application:app_slash_command:write",
	"application:application:self_manage",
	"application:bot.basic_info:read",
	"application:bot.menu:write",
	"cardkit:card:read",
	"cardkit:card:write",
	"contact:contact.base:readonly",
	"docs:document.comment:create",
	"docs:document.comment:delete",
	"docs:document.comment:read",
	"docs:document.comment:update",
	"docs:document.comment:write_only",
	"docx:document.block:convert",
	"docx:document:readonly",
	"docx:document:write_only",
	"drive:drive.metadata:readonly",
	"im:chat.members:bot_access",
	"im:chat:create",
	"im:chat:read",
	"im:chat:update",
	"im:message.group_at_msg.include_bot:readonly",
	"im:message.group_at_msg:readonly",
	"im:message.group_msg",
	"im:message.p2p_msg:readonly",
	"im:message.pins:read",
	"im:message.pins:write_only",
	"im:message.reactions:read",
	"im:message.reactions:write_only",
	"im:message:readonly",
	"im:message:send_as_bot",
	"im:message:send_multi_users",
	"im:message:send_sys_msg",
	"im:message:update",
	"im:resource",
	"wiki:node:read",
];
export const USER_SCOPES = [
	"im:chat.managers:write_only",
	"im:chat.members:read",
	"im:chat.members:write_only",
	"im:chat.membership_application:read",
	"im:chat.membership_application:write",
	"im:chat.moderation:read",
	"im:chat.nickname:read",
	"im:chat.nickname:write",
	"im:chat.user_setting:read",
	"im:chat.user_setting:write",
	"im:chat:create_by_user",
	"im:chat:moderation:write_only",
	"im:chat:read",
	"im:chat:update",
	"im:feed.flag:read",
	"im:feed.flag:write",
	"im:feed.shortcut:read",
	"im:feed.shortcut:write",
	"im:feed_group_v1:read",
	"im:feed_group_v1:write",
	"im:message",
	"im:message.group_msg:get_as_user",
	"im:message.p2p_msg:get_as_user",
	"im:message.pins:read",
	"im:message.pins:write_only",
	"im:message.reactions:read",
	"im:message.reactions:write_only",
	"im:message.send_as_user",
	"im:message:readonly",
	"im:message:recall",
	"im:message:update",
	"im:resource",
	"offline_access",
	"search:message",
];
export const EVENTS = ["im.message.receive_v1"];
export const CALLBACKS = ["card.action.trigger"];

export const APP_NAME = "Yonder";
export const APP_DESCRIPTION = "Yonder personal agent";

/** Same shape the official node-sdk `registerApp({ addons })` validates and encodes. */
export const addons = () => ({
	preset: true,
	scopes: { tenant: TENANT_SCOPES, user: USER_SCOPES },
	events: { items: { tenant: EVENTS } },
	callbacks: { items: CALLBACKS },
});

/** JSON → gzip → base64 → URL-safe, no padding (fixed by the platform). */
export const encodeAddons = (value: object = addons()): string =>
	gzipSync(Buffer.from(JSON.stringify(value), "utf8"))
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

const HOSTS = {
	feishu: { accounts: "https://accounts.feishu.cn", open: "open.feishu.cn" },
	lark: { accounts: "https://accounts.larksuite.com", open: "open.larksuite.com" },
};
export type Brand = keyof typeof HOSTS;

export interface Registration {
	deviceCode: string;
	url: string;
	interval: number;
	expiresAt: number;
}
export interface Created {
	appId: string;
	appSecret: string;
	domain: Brand;
}
export type Poll =
	| { status: "wait" | "slow_down"; domain: Brand }
	| { status: "denied" | "expired" }
	| ({ status: "confirmed" } & Created);

const post = async (fetcher: typeof fetch, brand: Brand, form: Record<string, string>, signal?: AbortSignal) => {
	const response = await fetcher(`${HOSTS[brand].accounts}/oauth/v1/app/registration`, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams(form).toString(),
		...(signal ? { signal } : {}),
	});
	// RFC 8628 pending/slow_down answers arrive with HTTP 400 and a JSON body.
	const text = await response.text();
	try {
		return object(JSON.parse(text));
	} catch {
		throw new Error(`Feishu app registration failed: HTTP ${response.status}`);
	}
};

/** Build the single link the owner opens: creates a PersonalAgent app with every scope in one confirmation. */
export const creationUrl = (verificationUri: string, brand: Brand): string => {
	const url = new URL(verificationUri);
	url.hostname = HOSTS[brand].open;
	url.searchParams.set("from", "sdk");
	url.searchParams.set("source", "node-sdk/yonder");
	url.searchParams.set("tp", "sdk");
	url.searchParams.set("name", APP_NAME);
	url.searchParams.set("desc", APP_DESCRIPTION);
	url.searchParams.set("addons", encodeAddons());
	url.searchParams.set("createOnly", "true");
	return url.toString();
};

export async function begin(fetcher: typeof fetch, brand: Brand, signal?: AbortSignal): Promise<Registration> {
	const data = await post(
		fetcher,
		"feishu", // The protocol always bootstraps on Feishu; the poll switches domain for Lark tenants.
		{
			action: "begin",
			archetype: "PersonalAgent",
			auth_method: "client_secret",
			request_user_info: "open_id tenant_brand",
		},
		signal,
	);
	const deviceCode = string(data.device_code),
		uri = string(data.verification_uri_complete);
	if (!deviceCode || !uri)
		throw new Error(
			`Feishu app registration failed: ${string(data.error_description) || string(data.error) || "invalid response"}`,
		);
	const expires = Number(data.expires_in ?? data.expire_in);
	const interval = Number(data.interval);
	return {
		deviceCode,
		url: creationUrl(uri, brand),
		interval: interval > 0 ? interval : 5,
		expiresAt: Date.now() + (expires > 0 ? expires : 600) * 1000,
	};
}

export async function poll(
	fetcher: typeof fetch,
	deviceCode: string,
	domain: Brand,
	signal?: AbortSignal,
): Promise<Poll> {
	const data = await post(fetcher, domain, { action: "poll", device_code: deviceCode }, signal);
	const tenant = string(object(data.user_info).tenant_brand);
	const actual: Brand = tenant === "lark" ? "lark" : tenant === "feishu" ? "feishu" : domain;
	const error = string(data.error);
	if (!error) {
		const appId = string(data.client_id),
			appSecret = string(data.client_secret);
		if (appId && appSecret) return { status: "confirmed", appId, appSecret, domain: actual };
		return { status: "wait", domain: actual };
	}
	if (error === "authorization_pending") return { status: "wait", domain: actual };
	if (error === "slow_down") return { status: "slow_down", domain: actual };
	if (error === "access_denied") return { status: "denied" };
	if (error === "expired_token" || error === "invalid_grant") return { status: "expired" };
	throw new Error(`Feishu app registration failed: ${string(data.error_description) || error}`);
}

const FILE = "app.json";
export async function saveApp(directory: string, value: Created): Promise<void> {
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const temporary = join(directory, `app-${process.pid}.tmp`);
	await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
	await rename(temporary, join(directory, FILE));
}
