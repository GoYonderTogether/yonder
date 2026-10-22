import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ExecutionOwner, PluginAPI, ToolContext, YEvent } from "@yonder/sdk";
import { checkPlugin, createRegistrationCollector } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { config } from "../src/config.js";
import { consume, pasteFile } from "../src/consumers.js";
import plugin from "../src/index.js";
import { allowedPath, hash, Store } from "../src/store.js";

const scope: ExecutionOwner = { agent: "main", profile: "owner", session: "1" };
const signal = () => AbortSignal.timeout(20000);
async function temporary() {
	return realpath(await mkdtemp(join(tmpdir(), "yonder-clipboard-")));
}

test("manifest matches SDK registration; installation grants no access or setup side effects", async () => {
	const dir = resolve("plugins/clipboard");
	expect(await checkPlugin(dir)).toEqual([]);
	expect(existsSync(join(dir, ".yonder-contract-data"))).toBe(false);
});
test("configuration defaults deny and rejects unsafe limits, ambiguous grants and arbitrary consumers", () => {
	expect(config(undefined).grants).toEqual([]);
	for (const c of [
		{ maxBytes: 0 },
		{ ttlSeconds: Infinity },
		{ grants: [{ ...scope }, { ...scope }] },
		{ grants: [{ ...scope, readRoots: ["relative"] }] },
		{ consumers: { x: { kind: "http", url: "http://localhost", method: "POST" } } },
		{ consumers: { x: { kind: "http", url: "https://example.com/?token=x", method: "POST" } } },
		{ consumers: { x: { kind: "child", file: "sh", cwd: "/tmp", variable: "X" } } },
	])
		expect(() => config(c)).toThrow();
});
test("open content preserves awkward bytes, scope, TTL, byte limit and integrity; drop keeps shared blobs", async () => {
	const root = await temporary(),
		store = new Store(root, { maxBytes: 256000, ttlSeconds: 3600 });
	const value = Buffer.from('中文🦤 </message> "\\\n\r\u0000'.repeat(2400));
	try {
		const a = await store.save(value, "open", scope, { type: "test", ref: "generated" }, signal());
		const b = await store.save(value, "open", scope, { type: "test", ref: "generated" }, signal());
		expect(a.sha256).toBe(hash(value));
		await store.consume(a, signal(), async (bytes) => expect(bytes.equals(value)).toBe(true));
		for (const owner of [
			{ ...scope, session: "2" },
			{ ...scope, profile: "guest" },
			{ ...scope, agent: "other" },
		])
			await expect(store.get(a.id, owner)).rejects.toThrow("scope");
		await expect(store.save(Buffer.alloc(256001), "open", scope, a.source, signal())).rejects.toThrow("large");
		await writeFile(store.path(a.id), JSON.stringify({ ...a, expiresAt: new Date(0).toISOString() }));
		await expect(store.get(a.id, scope)).rejects.toThrow("expired");
		await store.drop(a, signal());
		await store.consume(b, signal(), async (bytes) => expect(bytes.equals(value)).toBe(true));
		await writeFile(join(root, "blobs", b.sha256), "corrupt");
		await expect(store.consume(b, signal(), async () => {})).rejects.toThrow("hash");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
test("file destination is create-only, byte exact, 0600; roots and symlinks cannot widen grants", async () => {
	const root = await temporary(),
		outside = await temporary(),
		value = randomBytes(96),
		file = join(root, "out");
	try {
		expect(await allowedPath(file, [root], true)).toBe(file);
		await pasteFile(file, value, signal());
		expect((await readFile(file)).equals(value)).toBe(true);
		const fd = await import("node:fs/promises");
		expect((await fd.stat(file)).mode & 0o777).toBe(0o600);
		await expect(pasteFile(file, Buffer.from("overwrite"), signal())).rejects.toThrow();
		expect((await readFile(file)).equals(value)).toBe(true);
		await expect(allowedPath(join(outside, "x"), [root], true)).rejects.toThrow("granted");
		await symlink(outside, join(root, "linked"));
		await expect(allowedPath(join(root, "linked/x"), [root], true)).rejects.toThrow("symlink");
		const aborted = AbortSignal.abort();
		await expect(pasteFile(join(root, "cancel"), value, aborted)).rejects.toThrow();
		expect(existsSync(join(root, "cancel"))).toBe(false);
	} finally {
		await rm(root, { recursive: true, force: true });
		await rm(outside, { recursive: true, force: true });
	}
});
// Protocol fixture only, no simulated model. All file/storage effects are real.
async function protocol(root: string, granted = true) {
	const { api, registrations } = createRegistrationCollector();
	const events: YEvent[] = [];
	await plugin.setup({
		...api,
		id: "clipboard",
		version: "test",
		paths: { data: join(root, "data") },
		config: { grants: granted ? [{ ...scope, sealed: true, readRoots: [root], writeRoots: [root] }] : [] },
		events: {
			...api.events,
			async emit(e) {
				const event = { ...e, id: String(events.length + 1), ts: new Date().toISOString() };
				events.push(event);
				return event;
			},
			async query(q) {
				return { events: events.filter((e) => e.type === q.type && e.conv === q.conv) };
			},
		},
		sessions: {
			async transcript() {
				return [{ id: 12, kind: "pi.tool-result", text: "generated tool output" }];
			},
		},
	} as unknown as PluginAPI);
	const ctx = {
		...scope,
		capabilities: ["read", "write"],
		env: { id: "node:local" },
		signal: signal(),
		event: { id: "in", ts: new Date().toISOString(), type: "message.in", conv: "conv:test:ours", data: { text: "go" } },
	} as ToolContext;
	const call = (name: string, args: object, context = ctx) =>
		registrations.tools.find((t) => t.name === `clipboard_${name}`)?.execute(args, context);
	return { call, ctx, events, registrations };
}
test("copy schema allows exactly the two intended message argument forms, not extras or body text", async () => {
	const root = await temporary();
	try {
		const { registrations } = await protocol(root),
			tool = registrations.tools.find((t) => t.name === "clipboard_copy")!;
		const parameters = tool.parameters as {
			additionalProperties: boolean;
			properties: { from: { oneOf: Array<{ additionalProperties: boolean }> }; class: { enum: string[] } };
		};
		expect(parameters.additionalProperties).toBe(false);
		expect(parameters.properties.class.enum).toEqual(["open", "sealed"]);
		expect(parameters.properties.from.oneOf.every((variant) => variant.additionalProperties === false)).toBe(true);
		const source = { kind: "message", eventId: "inbound-id" };
		const isAllowed = (args: Record<string, unknown>) => {
			const from = args.from as Record<string, unknown> | undefined;
			return (
				Object.keys(args).every((key) => key === "from" || key === "class") &&
				from?.kind === "message" &&
				Object.keys(from).every((key) => key === "kind" || key === "eventId") &&
				typeof from.eventId === "string" &&
				(args.class === undefined || args.class === "open" || args.class === "sealed")
			);
		};
		for (const allowed of [{ from: source }, { from: source, class: "open" }]) expect(isAllowed(allowed)).toBe(true);
		for (const rejected of [
			{ from: source, class: "open", unexpected: true },
			{ from: { ...source, extra: true } },
			{ from: source, body: "synthetic-private-payload" },
		])
			expect(isAllowed(rejected)).toBe(false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
test("message and previous tool references copy verbatim, refuse foreign conversations and sealed history", async () => {
	const root = await temporary();
	try {
		const p = await protocol(root),
			body = "中文🦤\n</message> & \\ awkward";
		p.events.push(
			{ id: "source", ts: new Date().toISOString(), type: "message.in", conv: "conv:test:ours", data: { text: body } },
			{
				id: "foreign",
				ts: new Date().toISOString(),
				type: "message.in",
				conv: "conv:test:theirs",
				data: { text: "foreign" },
			},
		);
		const copied = await p.call("copy", { from: { kind: "message", eventId: "source" } });
		expect(copied.isError).toBeUndefined();
		expect(copied.text).not.toContain(body);
		const id = JSON.parse(copied.text).id;
		await p.call("paste", { handle: id, to: { kind: "file", path: join(root, "out") } });
		expect(await readFile(join(root, "out"), "utf8")).toBe(body);
		expect((await p.call("copy", { from: { kind: "message", eventId: "foreign" } })).isError).toBe(true);
		expect((await p.call("copy", { from: { kind: "message", eventId: "source" }, class: "sealed" })).isError).toBe(
			true,
		);
		expect((await p.call("copy", { from: { kind: "tool", transcriptId: 12 } })).isError).toBeUndefined();
		expect((await p.call("copy", { from: { kind: "tool", transcriptId: 13 } })).isError).toBe(true);
		expect((await p.call("paste", { handle: id, to: { kind: "consumer", id: "arbitrary" } })).text).toBe(
			"consumer_not_granted",
		);
		expect((await p.call("paste", { handle: id, to: { kind: "message", target: "owner" } })).isError).toBe(true);
		expect((await p.call("list", {}, { ...p.ctx, env: { id: "remote" } } as ToolContext)).text).toBe(
			"local_environment_required",
		);
		const denied = await protocol(root, false);
		expect((await denied.call("copy", { from: { kind: "message", eventId: "source" } })).text).toBe(
			"profile_not_granted",
		);
		expect(JSON.stringify(p.events.filter((e) => e.type === "clipboard.audit"))).not.toContain(body);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
test("file byte ranges preserve bytes, invalid range fails, TTY capture refuses redirected input", async () => {
	const root = await temporary();
	try {
		const p = await protocol(root),
			file = join(root, "input");
		await writeFile(file, Buffer.from([0, 255, 10, 13, 7]));
		const r = await p.call("copy", { from: { kind: "file", path: file, start: 1, end: 4 } }),
			id = JSON.parse(r.text).id;
		await p.call("paste", { handle: id, to: { kind: "file", path: join(root, "range") } });
		expect([...(await readFile(join(root, "range")))]).toEqual([255, 10, 13]);
		expect((await p.call("copy", { from: { kind: "file", path: file, start: 3, end: 2 } })).isError).toBe(true);
		const { readHiddenCredential } = await import("../src/hidden-input.js");
		await expect(readHiddenCredential()).rejects.toThrow("TTY");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
test("fixed child env injection excludes host credentials, returns only status and respects cancellation", async () => {
	const data = randomBytes(64).toString("hex"),
		consumer = {
			kind: "child" as const,
			file: process.execPath,
			args: [
				"-e",
				"if(!process.env.CLIP_VALUE || process.env.HOME || process.env.OPENAI_API_KEY) process.exit(2);console.log(process.env.CLIP_VALUE);",
			],
			cwd: process.cwd(),
			variable: "CLIP_VALUE",
		};
	const result = await consume(consumer, Buffer.from(data), signal());
	expect(result).toEqual({ ok: true, exitCode: 0 });
	expect(JSON.stringify(result)).not.toContain(data);
	await expect(
		consume({ ...consumer, args: ["-e", "setInterval(()=>{},1000)"] }, Buffer.from(data), AbortSignal.timeout(50)),
	).rejects.toThrow("cancelled");
});
