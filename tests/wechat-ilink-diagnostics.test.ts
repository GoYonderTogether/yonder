import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Attachment, PluginAPI } from "@yonder/sdk";
import { expect, test, vi } from "vitest";
import { IlinkChannel } from "../plugins/channel-wechat-ilink/src/channel.js";
import { createClient, IlinkRequestError } from "../plugins/channel-wechat-ilink/src/client.js";

// All transport responses below are mocks; no network, live account, model or Keychain.
const base = "http://127.0.0.1:1";
const secrets = [
	"PRIVATE_TOKEN",
	"PRIVATE_CONTEXT",
	"PRIVATE_SIGNED_QUERY",
	"PRIVATE_RESPONSE",
	"PRIVATE_FILE_BYTES",
	"PRIVATE_TEXT",
	"PRIVATE_FILENAME",
] as const;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

type Stage = "upload-url" | "cdn-upload" | "sendmessage";
type Failure = "http" | "ret" | "errcode" | "transport" | "invalid-ret";
async function harness(stage: Stage, failure: Failure, status = 403, failPart = 1) {
	const directory = await mkdtemp("/tmp/yonder-ilink-diagnostics-test-");
	await mkdir(join(directory, "mock-wechat"));
	await writeFile(
		join(directory, "mock-wechat/account.json"),
		JSON.stringify({
			base: "https://ilinkai.weixin.qq.com",
			cursor: "",
			peer: "mock-peer",
			bot: "mock-bot",
			linked: true,
			token: secrets[0],
			contexts: { "mock-peer": secrets[1] },
			seen: {},
		}),
	);
	const file = join(directory, "attachment.bin");
	await writeFile(file, secrets[4]);
	const warn = vi.fn();
	const credentials = vi.fn(async () => {
		throw new Error("must not access credentials");
	});
	const api = { paths: { data: directory }, credentials: { get: credentials }, log: { warn } } as unknown as PluginAPI;
	let parts = 0;
	const transport = vi.fn<typeof fetch>(async (input) => {
		const path = new URL(String(input)).pathname;
		const current: Stage = path.endsWith("getuploadurl")
			? "upload-url"
			: path === "/upload"
				? "cdn-upload"
				: "sendmessage";
		if (current === "sendmessage") parts++;
		if (current === stage && (current !== "sendmessage" || parts === failPart)) {
			if (failure === "transport") throw new Error(secrets.join(" "));
			if (failure === "http") return new Response(secrets[3], { status });
			return json({
				...(failure === "ret" ? { ret: -14 } : failure === "errcode" ? { ret: 0, errcode: -32 } : { ret: secrets[3] }),
				errmsg: secrets.join(" "),
			});
		}
		if (current === "upload-url") return json({ ret: 0, upload_full_url: `${base}/upload?signature=${secrets[2]}` });
		if (current === "cdn-upload") return new Response("", { headers: { "x-encrypted-param": secrets[2] } });
		return json({ ret: 0 });
	});
	const channel = new IlinkChannel("mock-wechat", {}, api, async () => undefined, {
		fetch: transport,
		testBaseUrl: base,
	});
	const attachment: Attachment = {
		kind: "file",
		uri: pathToFileURL(file).href,
		mime: "application/octet-stream",
		name: secrets[6],
	};
	return {
		channel,
		warn,
		transport,
		credentials,
		attachment,
		async close() {
			await channel.stop();
			await rm(directory, { recursive: true, force: true });
		},
	};
}

function assertSafe(value: unknown) {
	const serialized = JSON.stringify(value);
	for (const secret of secrets) expect(serialized).not.toContain(secret);
	return serialized;
}

test.each([
	["upload-url", "http", 403, { httpStatus: 403 }],
	["upload-url", "ret", 200, { httpStatus: 200, ret: -14 }],
	["upload-url", "errcode", 200, { httpStatus: 200, ret: 0, errcode: -32 }],
	["cdn-upload", "http", 403, { httpStatus: 403 }],
	["cdn-upload", "http", 503, { httpStatus: 503 }],
	["cdn-upload", "transport", 200, {}],
	["sendmessage", "http", 403, { httpStatus: 403 }],
	["sendmessage", "ret", 200, { httpStatus: 200, ret: -14 }],
	["sendmessage", "errcode", 200, { httpStatus: 200, ret: 0, errcode: -32 }],
	["sendmessage", "http", 503, { httpStatus: 503 }],
	["sendmessage", "transport", 200, {}],
	["sendmessage", "invalid-ret", 200, { httpStatus: 200 }],
] as const)("safe stage/codes survive %s %s (%i)", async (stage, failure, status, codes) => {
	const h = await harness(stage, failure, status);
	try {
		const delivery = await h.channel.send("conv:mock-wechat:mock-peer", {
			text: secrets[5],
			attachments: [h.attachment],
		});
		const rejected =
			stage === "sendmessage" && (failure === "ret" || failure === "errcode" || (failure === "http" && status === 403));
		const uncertain = stage === "sendmessage" && !rejected;
		expect(delivery.ok).toBe(false);
		expect(delivery.uncertain).toBe(uncertain ? true : undefined);
		expect(delivery.id).toEqual(uncertain ? expect.stringMatching(/^yonder-wechat-/) : undefined);
		expect(delivery.retryable).toBeUndefined();
		expect(delivery.error).toContain(
			rejected ? "ILINK_SEND_REJECTED" : uncertain ? "ILINK_DELIVERY_UNCERTAIN" : "ILINK_SEND_FAILED",
		);
		expect(delivery.error).toContain(`"stage":"${stage}"`);
		for (const [name, value] of Object.entries(codes)) expect(delivery.error).toContain(`"${name}":${value}`);
		expect(h.warn).toHaveBeenCalledExactlyOnceWith("iLink send failed", {
			instance: "mock-wechat",
			stage,
			...codes,
			reason: failure === "http" ? "http" : failure === "transport" ? "transport" : "ret",
			attempted: stage === "sendmessage",
			confirmedParts: 0,
			uncertain,
		});
		assertSafe({ delivery, logs: h.warn.mock.calls });
		// No retries at any stage, including failures before a message attempt.
		expect(h.transport).toHaveBeenCalledTimes(stage === "upload-url" ? 1 : stage === "cdn-upload" ? 2 : 3);
		expect(h.credentials).not.toHaveBeenCalled();
	} finally {
		await h.close();
	}
});

test.each(["ret", "transport"] as const)("partial success remains uncertain after %s; no replay", async (failure) => {
	const h = await harness("sendmessage", failure, 200, 2);
	try {
		const delivery = await h.channel.send("conv:mock-wechat:mock-peer", { text: "x".repeat(2001) });
		expect(delivery).toMatchObject({
			ok: false,
			uncertain: true,
			id: expect.stringMatching(/^yonder-wechat-/),
			error: expect.stringContaining("1 parts confirmed; do not resend"),
		});
		expect(delivery.error).toContain('"stage":"sendmessage"');
		expect(delivery.error).not.toContain("ILINK_SEND_REJECTED");
		expect(delivery.retryable).toBeUndefined();
		expect(h.warn.mock.calls[0]?.[1]).toMatchObject({ confirmedParts: 1, uncertain: true });
		expect(h.transport).toHaveBeenCalledTimes(2);
		assertSafe({ delivery, logs: h.warn.mock.calls });
	} finally {
		await h.close();
	}
});

test("success has no diagnostic failure log or duplicate requests", async () => {
	const h = await harness("sendmessage", "ret", 200, 3);
	try {
		expect(
			await h.channel.send("conv:mock-wechat:mock-peer", { text: secrets[5], attachments: [h.attachment] }),
		).toMatchObject({ ok: true });
		expect(h.warn).not.toHaveBeenCalled();
		expect(h.transport).toHaveBeenCalledTimes(4);
	} finally {
		await h.close();
	}
});

test("local attachment failure only exposes a fixed stage, not a path or filename", async () => {
	const h = await harness("sendmessage", "ret");
	try {
		const delivery = await h.channel.send("conv:mock-wechat:mock-peer", {
			text: "",
			attachments: [{ ...h.attachment, uri: `file:///tmp/${secrets[6]}/missing` }],
		});
		expect(delivery).toMatchObject({ ok: false, error: 'ILINK_SEND_FAILED; {"stage":"attachment-read"}' });
		expect(h.transport).not.toHaveBeenCalled();
		assertSafe({ delivery, logs: h.warn.mock.calls });
	} finally {
		await h.close();
	}
});

test.each(["credential", "fetch", "body"])("raw %s exceptions are discarded, not kept as a cause", async (where) => {
	const fail = async () => {
		throw new Error(secrets.join(" "));
	};
	const client = createClient({
		base: () => base,
		token: where === "credential" ? fail : async () => secrets[0],
		signal: new AbortController().signal,
		saveMedia: async () => {
			throw new Error("unused");
		},
		fetch:
			where === "fetch"
				? fail
				: async () => (where === "body" ? ({ ok: true, status: 200, text: fail } as unknown as Response) : json({})),
	});
	try {
		await client.request("ilink/bot/sendmessage", { text: secrets[5] }, true);
		expect.fail("must fail");
	} catch (error) {
		expect(error).toBeInstanceOf(IlinkRequestError);
		const e = error as IlinkRequestError;
		expect(e.stage).toBe("sendmessage");
		expect(e.cause).toBeUndefined();
		assertSafe({ error: String(e), fields: e, stack: e.stack });
	}
});

test.each(["-14 PRIVATE_RESPONSE", Number.MAX_VALUE, 1.5, { token: "PRIVATE_TOKEN" }])(
	"only safe integer response codes enter diagnostics: %j",
	async (ret) => {
		const client = createClient({
			base: () => base,
			token: async () => undefined,
			signal: new AbortController().signal,
			saveMedia: async () => {
				throw new Error("unused");
			},
			fetch: async () => json({ ret }),
		});
		try {
			await client.request("ilink/bot/sendmessage");
			expect.fail("must fail");
		} catch (error) {
			const e = error as IlinkRequestError;
			expect(e.diagnostic).toEqual({ stage: "sendmessage", reason: "ret", httpStatus: 200 });
			expect(e.rejected).toBe(false);
			assertSafe({ error: String(e), fields: e });
		}
	},
);
