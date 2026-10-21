import { createCipheriv } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Channel, EventInput, PluginAPI, ToolContext } from "@yonder/sdk";
import { checkPlugin, createRegistrationCollector } from "@yonder/sdk/testing";
import { expect, test, vi } from "vitest";
import { openDatabase } from "../packages/core/src/runtime/db.js";
import { createStore } from "../packages/core/src/store/index.js";
import { createClient } from "../plugins/channel-wechat-ilink/src/client.js";
import ilink from "../plugins/channel-wechat-ilink/src/index.js";
import { Archive } from "../plugins/wechat-archive/src/archive.js";
import archivePlugin from "../plugins/wechat-archive/src/index.js";

async function harness(id: string, config: unknown = {}) {
	const directory = await mkdtemp("/tmp/yonder-wechat-test-");
	const db = await openDatabase(":memory:");
	const store = await createStore(db, () => "person:owner");
	const identity = store.identity();
	await identity.createPerson({ id: "owner", name: "Transport test owner" });
	await identity.createPerson({ id: "contact", name: "Transport test contact" });
	const collector = createRegistrationCollector();
	const api = {
		...collector.api,
		id,
		version: "0.2.26102004",
		config,
		paths: { data: directory },
		identity,
		events: { ...collector.api.events, query: store.events.query, emit: store.events.record },
		credentials: { get: async () => undefined },
		log: { info: () => {}, warn: () => {}, error: () => {} },
	} as unknown as PluginAPI;
	return {
		...collector,
		api,
		identity,
		store,
		directory,
		async close() {
			await db.close();
			await rm(directory, { recursive: true, force: true });
		},
	};
}
const context = (capabilities: ToolContext["capabilities"] = ["read", "write", "network", "message", "admin"]) => ({
	agent: "main",
	session: "1",
	profile: "owner",
	capabilities,
	signal: new AbortController().signal,
	env: {} as ToolContext["env"],
});

test("both native WeChat plugins satisfy manifests without IO during setup", async () => {
	for (const name of ["wechat-archive", "channel-wechat-ilink"])
		expect(await checkPlugin(fileURLToPath(new URL(`../plugins/${name}/`, import.meta.url)))).toEqual([]);
});

test("QR pairing persists first owner, keeps second independent and uses per-peer context through the real event/identity store", async () => {
	const h = await harness("channel-wechat-ilink", { owner: "person:owner" });
	const channels: Channel[] = [];
	const sends: Record<string, any>[] = [];
	const pending = new Map<string, unknown[]>();
	let sequence = 0;
	let sendFailure = "none";
	const server = createServer(async (req, res) => {
		const chunks: Buffer[] = [];
		for await (const chunk of req) chunks.push(chunk);
		const data = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
		const url = new URL(req.url!, "http://localhost");
		let result: unknown = { ret: 0 };
		if (url.pathname.endsWith("get_bot_qrcode")) {
			sequence++;
			result = { qrcode: String(sequence), qrcode_img_content: `https://example.invalid/test-qr-${sequence}` };
		} else if (url.pathname.endsWith("get_qrcode_status")) {
			const n = url.searchParams.get("qrcode");
			result = {
				status: "confirmed",
				ilink_bot_id: `bot-${n}`,
				ilink_user_id: `peer-${n}`,
				bot_token: `test-token-${n}`,
			};
		} else if (url.pathname.endsWith("getupdates")) {
			const token = String(req.headers.authorization);
			result = { msgs: pending.get(token) ?? [], get_updates_buf: "next" };
			pending.delete(token);
		} else if (url.pathname.endsWith("sendmessage")) {
			sends.push(data.msg);
			if (sendFailure === "disconnect") {
				req.socket.destroy();
				return;
			}
			if (sendFailure === "reject") result = { ret: -14 };
		}
		res.setHeader("content-type", "application/json");
		res.end(JSON.stringify(result));
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	const address = server.address() as { port: number };
	const original = globalThis.fetch;
	vi.spyOn(globalThis, "fetch").mockImplementation((url, init) =>
		original(
			new URL(new URL(String(url)).pathname + new URL(String(url)).search, `http://127.0.0.1:${address.port}`),
			init,
		),
	);
	try {
		await ilink.setup(h.api);
		const provider = h.registrations.channels[0]!;
		const first = await provider.create("wechat-primary", { allowedUsers: ["extra-peer"] });
		const second = await provider.create("wechat-contact", {});
		const third = await provider.create("wechat-known", { person: "person:contact" });
		channels.push(first, second, third);
		const login = h.registrations.tools.find((t) => t.name.endsWith("_login"))!;
		for (const instance of ["wechat-primary", "wechat-contact", "wechat-known"]) {
			expect(
				(await login.execute(instance === "wechat-primary" ? {} : { instance, action: "start" }, context())).isError,
			).toBeUndefined();
			if (instance === "wechat-primary") {
				expect((await login.execute({}, context())).isError).toBeUndefined();
				expect(sequence).toBe(1);
			}
			if (instance === "wechat-known")
				await expect
					.poll(() => h.identity.relation("main", "acct:wechat-known:peer-3"), { timeout: 5000 })
					.toBe("known");
			const paired = await login.execute({ instance, action: "poll" }, context());
			expect(paired.isError).toBeUndefined();
			expect(paired.text).not.toContain("test-token");
		}
		expect(await h.identity.relation("main", "acct:wechat-primary:peer-1")).toBe("owner");
		expect(await h.identity.relation("main", "acct:wechat-contact:peer-2")).toBe("stranger");
		expect(await h.identity.relation("main", "acct:wechat-known:peer-3")).toBe("known");
		expect((await stat(join(h.directory, "wechat-primary/account.json"))).mode & 0o777).toBe(0o600);
		const envelope = (peer: string, id: string, token: string, bot = "bot-1") => ({
			message_type: 1,
			from_user_id: peer,
			to_user_id: bot,
			message_id: id,
			create_time_ms: Date.now(),
			context_token: token,
			item_list: [{ type: 1, text_item: { text: "Synthetic protocol input" } }],
		});
		pending.set("Bearer test-token-1", [
			envelope("peer-1", "m1", "owner-context"),
			envelope("extra-peer", "m2", "extra-context"),
			envelope("intruder", "m3", "wrong-context"),
			{ ...envelope("peer-1", "m4", "group-context"), group_id: "ordinary-group" },
		]);
		await first.start({
			emit: h.store.events.record,
			ask: async () => {
				throw new Error("unused");
			},
		});
		await expect
			.poll(async () => (await h.store.events.query({ type: "message.in" })).events.length, { timeout: 5000 })
			.toBe(2);
		expect(await first.send("conv:wechat-primary:extra-peer", { text: "protocol reply" })).toMatchObject({ ok: true });
		expect(sends[0]).toMatchObject({ to_user_id: "extra-peer", context_token: "extra-context" });
		expect(await first.send("conv:wechat-primary:peer-1", { text: "owner reply" })).toMatchObject({ ok: true });
		expect(sends[1]).toMatchObject({ to_user_id: "peer-1", context_token: "owner-context" });
		expect(await first.send("conv:wechat-primary:peer-1", { text: "😀".repeat(2001) })).toMatchObject({ ok: true });
		expect(Array.from(sends[2]!.item_list[0].text_item.text)).toHaveLength(2000);
		expect(Array.from(sends[3]!.item_list[0].text_item.text)).toHaveLength(1);
		sendFailure = "disconnect";
		const before = sends.length;
		expect(await first.send("conv:wechat-primary:peer-1", { text: "unknown outcome" })).toMatchObject({
			ok: false,
			uncertain: true,
		});
		expect(sends).toHaveLength(before + 1);
		sendFailure = "reject";
		expect(await first.send("conv:wechat-primary:peer-1", { text: "definite rejection" })).toMatchObject({
			ok: false,
			error: "ILINK_SEND_REJECTED",
		});
		sendFailure = "none";

		expect(await second.send("conv:wechat-contact:peer-2", { text: "no prior contact" })).toMatchObject({
			ok: false,
			error: expect.stringContaining("ILINK_CONTEXT_MISSING"),
		});
		expect(await first.send("conv:wechat-contact:peer-2", { text: "wrong instance" })).toMatchObject({ ok: false });
		const firstEvents = (await h.store.events.query({ type: "message.in" })).events;
		expect(firstEvents.map((e) => e.from).sort()).toEqual([
			"acct:wechat-primary:extra-peer",
			"acct:wechat-primary:peer-1",
		]);
		expect(JSON.stringify(firstEvents)).not.toContain("context");
		await first.stop();
		// Registration order changes, while the original primary reservation persists.
		const restarted = createRegistrationCollector();
		const api = { ...h.api, ...restarted.api, events: h.api.events };
		await ilink.setup(api);
		const p = restarted.registrations.channels[0]!;
		const later = await p.create("wechat-added", {});
		channels.push(later);
		const saved = await p.create("wechat-primary", {});
		channels.push(saved);
		const resumedLogin = restarted.registrations.tools.find((t) => t.name.endsWith("_login"))!;
		await resumedLogin.execute({ instance: "wechat-added", action: "start" }, context());
		const result = await resumedLogin.execute({ instance: "wechat-added", action: "poll" }, context());
		expect(JSON.parse(result.text)).toMatchObject({ person: null });
		expect(await h.identity.relation("main", "acct:wechat-added:peer-4")).toBe("stranger");
		await saved.start({
			emit: h.store.events.record,
			ask: async () => {
				throw new Error("unused");
			},
		});
		pending.set("Bearer test-token-1", [envelope("peer-1", "m1", "renewed-context")]);
		await new Promise((r) => setTimeout(r, 1200));
		expect((await h.store.events.query({ type: "message.in" })).events).toHaveLength(2);
	} finally {
		await Promise.allSettled(channels.map((c) => c.stop()));
		vi.restoreAllMocks();
		await new Promise<void>((r) => server.close(() => r()));
		await h.close();
	}
});

test("media protocol decrypts actual HTTP bytes and rejects untrusted download origins", async () => {
	const temporary = await mkdtemp("/tmp/yonder-wechat-upload-");
	const signal = new AbortController().signal,
		key = Buffer.alloc(16, 7),
		plain = Buffer.from("89504e470d0a1a0a00000000", "hex");
	const cipher = createCipheriv("aes-128-ecb", key, null),
		encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
	let saved: Uint8Array | undefined;
	const uploads: Buffer[] = [];
	const server = createServer(async (req, res) => {
		if (req.url === "/json") {
			res.end('{"message_id":18446744073709551615}');
			return;
		}
		if (req.url === "/ilink/bot/getuploadurl") {
			for await (const chunk of req) {
			}
			res.end(
				JSON.stringify({ upload_full_url: `http://127.0.0.1:${(server.address() as { port: number }).port}/upload` }),
			);
			return;
		}
		if (req.url === "/upload") {
			for await (const chunk of req) uploads.push(chunk);
			res.setHeader("x-encrypted-param", "test-reference");
			res.end();
			return;
		}
		res.end(encrypted);
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	const port = (server.address() as { port: number }).port;
	const base = `http://127.0.0.1:${port}`;
	const client = createClient({
		base: () => base,
		token: async () => "test-token",
		signal,
		testBaseUrl: base,
		saveMedia: async (bytes, name, mime) => {
			saved = bytes;
			return { kind: "image", mime, name, uri: "file:///tmp/protocol-only.png" };
		},
	});
	try {
		const items = await client.download({
			type: 2,
			image_item: { aeskey: key.toString("hex"), media: { full_url: `${base}/media` } },
		});
		expect(Buffer.from(saved!)).toEqual(plain);
		expect((await client.request("json")).message_id).toBe("18446744073709551615");
		const file = join(temporary, "test.bin");
		await writeFile(file, plain);
		const uploaded = await client.upload(
			{ kind: "audio", mime: "audio/wav", uri: new URL(`file://${file}`).href, name: "test.wav" },
			"test-peer",
		);
		expect(uploaded).toMatchObject({ type: 4, file_item: { file_name: "test.wav" } });
		expect(Buffer.concat(uploads).length).toBeGreaterThan(plain.length);
		expect(items[0]).toMatchObject({ kind: "image", mime: "image/png" });
		await expect(
			client.download({ type: 2, image_item: { media: { full_url: "http://127.0.0.1/private" } } }),
		).rejects.toThrow("untrusted CDN");
	} finally {
		await new Promise<void>((r) => server.close(() => r()));
		await rm(temporary, { recursive: true, force: true });
	}
});

async function archiveSource(directory: string) {
	const script = join(directory, "source.mjs"),
		data = join(directory, "source.json");
	await writeFile(data, JSON.stringify({ messages: [], cursor: 0, ack: 0, calls: [] }));
	await writeFile(
		script,
		`#!/usr/bin/env node
import{readFileSync,writeFileSync}from'node:fs';
const file=${JSON.stringify(data)},state=JSON.parse(readFileSync(file,'utf8')),args=process.argv.slice(2),cmd=args[0],get=k=>args[args.indexOf(k)+1];
state.calls.push(args);let result={ok:true};
if(cmd==='status')result.last_sync={at:Date.now()/1000};
if(cmd==='catalog')Object.assign(result,{catalog:[{chat:'Msg_abc',displayName:'Protocol fixture',chatType:'p2p'}],nextOffset:null,total:1});
if(cmd==='fetch-new'&&args.includes('--from-now')){state.ack=state.cursor;Object.assign(result,{cursor:state.cursor});}
else if(cmd==='check-new'){if(args.includes('--ack'))state.ack=Number(get('--ack'));Object.assign(result,{cursor:state.ack,count:state.messages.filter(m=>m.id>state.ack).length});}
else if(cmd==='window'||cmd==='fetch-new')Object.assign(result,{cursor:state.cursor,messages:state.messages.filter(m=>m.id>state.ack)});
if(cmd==='history'||cmd==='search')Object.assign(result,{messages:state.messages,nextBefore:null});
if(cmd==='message')result.message=state.messages.find(m=>m.id===Number(args[1]));
writeFileSync(file,JSON.stringify(state));console.log(JSON.stringify(result));
`,
		{ mode: 0o700 },
	);
	return {
		script,
		data,
		async append(id: number) {
			const state = JSON.parse(await readFile(data, "utf8"));
			state.cursor = id;
			state.messages.push({
				id,
				chat: "Msg_abc",
				text: "Synthetic archive input",
				timestamp: Math.floor(Date.now() / 1000),
				direction: "unknown",
				normalized: { kind: "text" },
			});
			await writeFile(data, JSON.stringify(state));
		},
	};
}

test("archive resumes durable material after unknown admission; silence, policy versions and private capabilities remain enforced", async () => {
	const h = await harness("wechat-archive");
	const fixture = await archiveSource(h.directory);
	const config = { cliPath: fixture.script, discovery: true };
	let archive = new Archive(h.api, config);
	try {
		await archive.poll(h.store.events.record);
		await fixture.append(1);
		let once = true;
		const unknown = async (input: EventInput) => {
			const e = await h.store.events.record(input);
			if (once) {
				once = false;
				throw new Error("lost admission response");
			}
			return e;
		};
		await expect(archive.poll(unknown)).rejects.toThrow("lost admission");
		const disk = JSON.parse(await readFile(fixture.data, "utf8"));
		expect(disk.ack).toBe(1);
		expect((await h.store.events.query({ type: "wechat-archive.material" })).events).toHaveLength(1);
		await archive.stop();
		archive = new Archive(h.api, config);
		await archive.poll(h.store.events.record);
		expect((await h.store.events.query({ type: "wechat-archive.material" })).events).toHaveLength(1);
		const ctx = context();
		await expect(
			archive.tool("policy", { op: "set", chat: "Msg_abc", expectedVersion: 9, priority: "silent" }, ctx.signal),
		).rejects.toThrow("VERSION_CONFLICT");
		await archive.tool("policy", { op: "set", chat: "Msg_abc", expectedVersion: 1, priority: "silent" }, ctx.signal);
		await expect(archive.tool("history", { chat: "Msg_abc" }, ctx.signal)).rejects.toThrow("OUT_OF_SCOPE");
		await fixture.append(2);
		await archive.poll(h.store.events.record);
		expect((await h.store.events.query({ type: "wechat-archive.material" })).events).toHaveLength(1);
		await archivePlugin.setup({ ...h.api, config: {} });
		const history = h.registrations.tools.find((t) => t.name.endsWith("_history"))!;
		expect(history.capabilities).toEqual(["read", "admin"]);
		expect(await history.execute({ chat: "Msg_abc" }, context(["read"]))).toMatchObject({ isError: true });
		await h.registrations.triggers[0]!.stop();
		await archive.stop();
		archive = new Archive(h.api, { ...config, pinnedPolicies: { Msg_abc: { priority: "watch" } } });
		expect(
			JSON.parse((await archive.tool("policy", { op: "get", chat: "Msg_abc" }, ctx.signal)).text).policy.userPinned,
		).toBe(true);
		await expect(
			archive.tool("policy", { op: "set", chat: "Msg_abc", expectedVersion: 2, priority: "silent" }, ctx.signal),
		).rejects.toThrow("USER_PINNED");
	} finally {
		await archive.stop();
		await h.close();
	}
});

test("archive media reader rejects symlink escapes and raw XML is never exposed", async () => {
	const { readWechatMediaFile, safeMessage } = await import("../plugins/wechat-archive/src/source.js");
	const directory = await mkdtemp("/tmp/yonder-wechat-media-");
	try {
		await mkdir(join(directory, "media"));
		await writeFile(join(directory, "outside"), "private");
		await symlink(join(directory, "outside"), join(directory, "media", "link"));
		await expect(readWechatMediaFile(join(directory, "media"), join(directory, "media", "link"), 100)).rejects.toThrow(
			"PATH_UNSAFE",
		);
		const value = safeMessage(
			{ id: 1, chat: "Msg_abc", text: "normalized", raw: "<xml>private</xml>", direction: "unknown" },
			"Msg_abc",
		);
		expect(JSON.stringify(value)).not.toContain("xml");
		expect(value.direction).toBe("unknown");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

async function kernelHome(real = false) {
	const { initHome, inspectHome, openKernel } = await import("../packages/core/src/kernel/index.js");
	const { parse, stringify } = await import("yaml");
	const home = await mkdtemp("/tmp/yonder-wechat-kernel-");
	await initHome(home);
	const config = parse(await readFile(join(home, "yonder.yaml"), "utf8"));
	config.plugins.push(
		{ use: "@yonder/plugin-channel-wechat-ilink", config: { owner: "person:owner" } },
		{ use: "@yonder/plugin-wechat-archive", config: {} },
	);
	config.channels["wechat-primary"] = { type: "wechat-ilink" };
	config.channels["wechat-contact"] = { type: "wechat-ilink", person: null };
	if (real) config.credentials = process.env.YONDER_TEST_AUTH;
	await writeFile(join(home, "yonder.yaml"), stringify(config));
	const agentFile = join(home, "agents/main/agent.yaml"),
		agent = parse(await readFile(agentFile, "utf8"));
	agent.defaults.plugins.push("channel-wechat-ilink", "wechat-archive");
	agent.profiles.guest = {
		level: "readonly",
		plugins: ["channel-wechat-ilink", "wechat-archive"],
		tools: { offer: ["*"] },
	};
	agent.bindings.push(
		{
			id: "wechat-owner",
			match: { channel: ["wechat-primary", "wechat-contact"], from: "owner" },
			session: "main",
			profile: "owner",
			wake: "write",
		},
		{
			id: "wechat-contacts",
			match: { channel: ["wechat-primary", "wechat-contact"] },
			session: { mode: "persistent", per: "conv" },
			profile: "guest",
			wake: "write",
		},
		{
			id: "wechat-material",
			match: { type: "wechat-archive.material" },
			session: "main",
			profile: "owner",
			wake: "write",
			reply: "none",
		},
	);
	await writeFile(agentFile, stringify(agent));
	expect(await inspectHome(home)).toMatchObject({ ok: true, errors: [] });
	if (real) {
		await writeFile(
			join(home, "presets/wechat-status.yaml"),
			stringify({
				schema: 1,
				description: "Verify actual WeChat plugin tool calls",
				model: "openai/gpt-6-luna",
				level: "bypass",
				plugins: ["wechat-archive", "channel-wechat-ilink"],
				tools: { offer: ["wechat-archive_status", "channel-wechat-ilink_status"] },
				contexts: [],
			}),
		);
	}
	const kernel = await openKernel(home);
	return {
		home,
		kernel,
		async close() {
			await kernel.close();
			await rm(home, { recursive: true, force: true });
		},
	};
}

test("real Yonder kernel loads both plugins; readonly contacts cannot discover private archive or login tools", async () => {
	const h = await kernelHome();
	try {
		const owner = (await h.kernel.management({ action: "inspect", agent: "main", profile: "owner" })) as {
			tools: { name: string; exposure: string }[];
		};
		const guest = (await h.kernel.management({ action: "inspect", agent: "main", profile: "guest" })) as typeof owner;
		expect(owner.tools.filter((t) => t.name.startsWith("wechat-archive_"))).toHaveLength(7);
		expect(owner.tools.find((t) => t.name === "channel-wechat-ilink_login")).toMatchObject({ exposure: "offer" });
		expect(
			guest.tools.filter((t) => t.name.startsWith("wechat-archive_")).every((t) => t.exposure === "capability-denied"),
		).toBe(true);
		expect(guest.tools.find((t) => t.name === "channel-wechat-ilink_login")).toMatchObject({
			exposure: "capability-denied",
		});
		expect(guest.tools.find((t) => t.name === "channel-wechat-ilink_message")).toMatchObject({
			exposure: "capability-denied",
		});
		expect(guest.tools.find((t) => t.name === "channel-wechat-ilink_status")).toMatchObject({ exposure: "offer" });
	} finally {
		await h.close();
	}
});

test.skipIf(process.env.YONDER_TEST_REAL !== "1" || !process.env.YONDER_TEST_AUTH)(
	"real Luna calls both actual WeChat status tools in an isolated home",
	async () => {
		const h = await kernelHome(true);
		try {
			const session = await h.kernel.sessions.open({ preset: "wechat-status" });
			const result = await h.kernel.sessions.submit(
				session.id,
				{
					text: "Call wechat-archive_status with {} and channel-wechat-ilink_status with {}. Then briefly report their actual readiness. Do not log in, read chat history or send messages.",
				},
				{ wait: true },
			);
			expect(result).toMatchObject({ status: "done" });
			const transcript = await h.kernel.sessions.transcript(session.id);
			const names = transcript.flatMap((item) => item.tools ?? []).map((tool) => tool.name);
			expect(names).toContain("wechat-archive_status");
			expect(names).toContain("channel-wechat-ilink_status");
		} finally {
			await h.close();
		}
	},
	90000,
);
