import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { YEvent } from "@yonder/sdk";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { testModel } from "../config/test-support.js";
import { initHome, openKernel } from "./index.js";

test("native channel unknown slash reaches selected runtime hooks unchanged; builtins and unbound sources do not", async () => {
	const home = await mkdtemp(join(tmpdir(), "ya-"));
	let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
	const sockets: Socket[] = [];
	try {
		await initHome(home, "isolated-routing-user", { model: testModel, isolated: true });
		await rm(join(home, "presets"), { recursive: true });
		const capture = join(home, "hook.json");
		await writeFile(
			join(home, "package.json"),
			JSON.stringify({
				name: "slash-routing-probe",
				version: "0.0.0",
				type: "module",
				yonder: { apiVersion: 1, id: "slash-routing-probe", entry: "./probe.mjs", contributes: { hooks: ["probe"] } },
			}),
		);
		// Real selected hook and real runtime admission. Cancel before the provider request;
		// no model stub, credentials, fabricated output or production owner is involved.
		await writeFile(
			join(home, "probe.mjs"),
			`import { writeFile } from 'node:fs/promises';
export default { setup(api) { api.hooks.register({ id: 'probe', async beforeRequest(messages, ctx) {
  await writeFile(${JSON.stringify(capture)}, JSON.stringify({agent:ctx.agent,profile:ctx.profile,session:ctx.session,event:ctx.event,events:ctx.events,messages}));
  const cancelled = new Promise(resolve => ctx.signal.addEventListener('abort', resolve, {once:true}));
  void api.sessions.abort(ctx.session);
  await cancelled;
} }); } };`,
		);
		const config = parse(await readFile(join(home, "yonder.yaml"), "utf8"));
		config.plugins = [{ use: "@yonder/plugin-channel-cli" }, { use: home }];
		config.channels = { allowed: { type: "cli" }, unbound: { type: "cli" } };
		config.identity.persons[0].accounts = ["acct:allowed:local"];
		await writeFile(join(home, "yonder.yaml"), stringify(config));
		await writeFile(
			join(home, "agents/main/agent.yaml"),
			stringify({
				schema: 1,
				id: "main",
				name: "Isolated routing probe",
				owner: "person:isolated-routing-user",
				defaultProfile: "source",
				profiles: {
					source: {
						model: "openai/gpt-6-luna",
						capabilities: ["read"],
						plugins: ["slash-routing-probe"],
						contexts: [],
						skills: [],
						tools: { offer: [], search: [] },
					},
				},
				bindings: [
					{ id: "authorized", match: { kind: "dm", from: "owner" }, session: "main", profile: "source", stream: false },
				],
			}),
		);
		kernel = await openKernel(home);
		const running = kernel;
		const connect = async (channel: string) => {
			const socket = createConnection(join(home, ".yonder/plugins/channel-cli", `${channel}.sock`));
			sockets.push(socket);
			const packets: Array<{ type: string; text?: string; event?: YEvent }> = [];
			createInterface({ input: socket }).on("line", (line) => packets.push(JSON.parse(line)));
			await new Promise<void>((resolve, reject) => {
				socket.once("connect", resolve);
				socket.once("error", reject);
			});
			return { socket, packets };
		};
		const allowed = await connect("allowed");
		const unbound = await connect("unbound");
		const submit = async (client: typeof allowed, text: string) => {
			const offset = client.packets.length;
			client.socket.write(`\u001e${JSON.stringify({ type: "input", text })}\n`);
			await expect.poll(() => client.packets.slice(offset).find((packet) => packet.type === "accepted")).toBeTruthy();
			const event = client.packets.slice(offset).find((packet) => packet.type === "accepted")?.event;
			if (!event) throw new Error("Native channel did not accept input");
			return event;
		};
		for (const text of ["/help", "/new", "/connect", "/model missing/provider", "/status unexpected", "/compact"]) {
			const event = await submit(allowed, text);
			await expect
				.poll(async () =>
					(await running.events.query({ type: "channel.command.result", after: event.id })).events.find(
						(e) => e.parent === event.id,
					),
				)
				.toBeTruthy();
		}
		await expect(readFile(capture, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
		const text = "/refine skills\n原始 slash 文本、换行与身份上下文。  ";
		const rejected = await submit(unbound, text);
		expect(rejected.routes).toEqual([{ agent: "main", binding: null, dropped: "no-binding" }]);
		const input = await submit(allowed, text);
		await expect
			.poll(async () => JSON.parse(await readFile(capture, "utf8")), { timeout: 10000 })
			.toMatchObject({
				agent: "main",
				profile: "source",
				session: input.routes?.[0]?.session,
				events: [input],
			});
		const captured = JSON.parse(await readFile(capture, "utf8"));
		// Native prepareInput may add attachments: []; source text, refs and routes stay intact.
		expect(captured.events[0]).toMatchObject(input);
		expect(input).toMatchObject({ from: "acct:allowed:local", conv: "conv:allowed:local", data: { kind: "dm", text } });
		expect(JSON.stringify(captured.messages)).toContain("/refine skills");
		await expect
			.poll(
				async () =>
					(await running.events.query({ type: "run.end", after: input.id })).events.find((e) => e.parent === input.id),
				{ timeout: 10000 },
			)
			.toBeTruthy();
		const events = (await running.events.query({ after: rejected.id })).events;
		expect(events.filter((e) => e.type.startsWith("channel.command"))).toEqual([]);
		expect(events.filter((e) => e.type === "run.end" && e.parent === rejected.id)).toEqual([]);
	} finally {
		for (const socket of sockets) socket.destroy();
		await kernel?.close();
		await rm(home, { recursive: true, force: true });
	}
}, 30000);
