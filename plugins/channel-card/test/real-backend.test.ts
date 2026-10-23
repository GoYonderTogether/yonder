import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { EventInput, PluginAPI, YEvent } from "@yonder/sdk";
import { expect, test, vi } from "vitest";
import { CardChannel } from "../src/channel.js";

const sibling = resolve("../yonder-card-web/server");
const prerequisites = [
	join(sibling, "test/services.ts"),
	join(sibling, "node_modules/tsx/dist/loader.mjs"),
	"/opt/homebrew/opt/postgresql@17/bin/initdb",
	"/opt/homebrew/opt/postgresql@17/bin/pg_ctl",
	"/opt/homebrew/bin/redis-server",
];
const missing = prerequisites.filter((path) => !existsSync(path));

test("real backend: device authorization → agents → hello → human DM → message.in → reply", async (ctx) => {
	if (missing.length) {
		ctx.skip(`Not tested: sibling/backend/local PostgreSQL or Redis missing: ${missing.join(", ")}`);
		return;
	}
	const child = spawn(
		process.execPath,
		[
			"--import",
			join(sibling, "node_modules/tsx/dist/loader.mjs"),
			resolve("plugins/channel-card/test/real-server.mjs"),
		],
		{ cwd: sibling, stdio: ["pipe", "pipe", "pipe"] },
	);
	let stderr = "";
	child.stderr.on("data", (data) => {
		stderr += data;
	});
	const exited = new Promise<number | null>((r) => child.once("exit", r));
	const lines = createInterface({ input: child.stdout });
	let endpoint: string;
	const data = await mkdtemp(join(tmpdir(), "yonder-card-real-"));
	let channel: CardChannel | undefined;
	try {
		endpoint = await new Promise<string>((resolveEndpoint, reject) => {
			const timer = setTimeout(() => reject(new Error(`Backend start timeout: ${stderr}`)), 60000);
			lines.on("line", (line) => {
				try {
					const value = JSON.parse(line);
					if (value.endpoint) {
						clearTimeout(timer);
						resolveEndpoint(value.endpoint);
					}
				} catch {}
			});
			child.once("exit", (code) => {
				clearTimeout(timer);
				reject(new Error(`Backend exited ${code}: ${stderr}`));
			});
		});
		async function call(path: string, method = "GET", body?: unknown, cookie?: string): Promise<Response> {
			const response = await fetch(`${endpoint}${path}`, {
				method,
				headers: {
					origin: endpoint,
					...(cookie ? { cookie } : {}),
					...(body !== undefined ? { "content-type": "application/json" } : {}),
				},
				...(body !== undefined ? { body: JSON.stringify(body) } : {}),
			});
			expect(response.ok, `${method} ${path}`).toBe(true);
			return response;
		}
		const registered = await call("/api/auth/register", "POST", {
			email: "human@loopback.test",
			name: "Human",
			password: "loopback-password",
		});
		const cookie = registered.headers.get("set-cookie")!.split(";")[0]!;
		const human = (await registered.json()).actor;
		const inputs: EventInput[] = [];
		const api = {
			paths: { data },
			agents: {
				list: async () => [
					{ id: "main", name: "Main" },
					{ id: "research", name: "Research" },
				],
			},
			log: { warn: () => {} },
		} as unknown as PluginAPI;
		channel = new CardChannel("card-real", { endpoint }, api);
		await channel.start({
			emit: async (event) => {
				inputs.push(event);
				return { ...event, id: String(inputs.length), ts: new Date().toISOString() } as YEvent;
			},
			ask: async () => {
				throw new Error("no models");
			},
		});
		const login = await channel.login("start", new AbortController().signal);
		const code = new URL(login.qrcodeUrl!).searchParams.get("code");
		await call("/api/device/confirm", "POST", { code }, cookie);
		expect(await channel.login("poll", new AbortController().signal)).toMatchObject({ status: "confirmed" });
		const contacts = await (await call("/api/contacts", "GET", undefined, cookie)).json();
		const agent = contacts.find((a: { name: string }) => a.name === "Research");
		expect(agent).toBeDefined();
		await vi.waitFor(async () => {
			const devices = await (await call("/api/devices", "GET", undefined, cookie)).json();
			expect(devices[0].online).toBe(true);
		});
		const dm = await (await call("/api/conversations/dm", "POST", { actorId: agent.id }, cookie)).json();
		const message = await (
			await call(
				`/api/conversations/${dm.id}/messages`,
				"POST",
				{ content: { type: "text", text: "Human DM to Research" } },
				cookie,
			)
		).json();
		await vi.waitFor(() => expect(inputs.some((e) => (e.data as { msgId: string }).msgId === message.id)).toBe(true));
		const input = inputs.find((e) => (e.data as { msgId: string }).msgId === message.id)!;
		expect(input).toMatchObject({
			conv: `conv:card-real:research:${dm.id}`,
			from: `acct:card-real:research:${human.id}`,
			data: { target: "research", kind: "dm", mentioned: true, text: "Human DM to Research" },
		});
		expect(await channel.send(input.conv!, { text: "Research reply", replyTo: message.id })).toMatchObject({
			ok: true,
		});
		const history = await (await call(`/api/conversations/${dm.id}/messages`, "GET", undefined, cookie)).json();
		expect(
			history.some(
				(m: { senderId: string; content: { text: string } }) =>
					m.senderId === agent.id && m.content.text === "Research reply",
			),
		).toBe(true);
		// Exercise the added device DM endpoint against real PostgreSQL too.
		expect(await channel.send(input.from!, { text: "Account target reply" })).toMatchObject({ ok: true });
		const draft = await channel.cardPush(
			"research",
			{ title: "Research", markdown: "Draft from the actual device" },
			new AbortController().signal,
		);
		expect(draft).toMatchObject({ ownerId: agent.id, status: "draft" });
	} finally {
		await channel?.stop();
		child.stdin.end("stop\n");
		const timer = setTimeout(() => child.kill("SIGTERM"), 10000);
		expect(await exited, stderr).toBe(0);
		clearTimeout(timer);
		lines.close();
		await rm(data, { recursive: true, force: true });
	}
}, 90000);
