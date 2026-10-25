import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import type { YEvent } from "@yonder/sdk";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { initHome, manageHome, openKernel } from "./index.js";

const auth = process.env.YONDER_TEST_AUTH ?? resolve(".yonder/auth.json");
test.skipIf(process.env.YONDER_TEST_REAL !== "1" || !existsSync(auth))(
	"real channel sources retain their replies, guest policy, agent questions and newly authored skills",
	async () => {
		const home = await mkdtemp("/tmp/yonder-p5-acceptance-");
		let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
		const sockets: Socket[] = [];
		try {
			await initHome(home);
			const config = parse(await readFile(`${home}/yonder.yaml`, "utf8"));
			config.credentials = auth;
			config.channels.alt = { type: "cli" };
			config.channels.guest = { type: "cli" };
			config.identity.persons[0].accounts.push("acct:alt:local");
			config.agents.push({ id: "helper", workspace: "./agents/helper" });
			await writeFile(`${home}/yonder.yaml`, stringify(config));
			const file = `${home}/agents/main/agent.yaml`;
			const agent = parse(await readFile(file, "utf8"));
			agent.defaults.contexts = [];
			agent.profiles.owner.tools = { offer: ["agent_ask", "write", "skill_view", "message_send"] };
			agent.profiles.owner.limits = { maxMinutes: 1 };
			agent.profiles.guest = { level: "readonly", tools: { offer: ["read", "write"] } };
			agent.bindings.find((binding: { id: string }) => binding.id === "owner")!.match.channel = ["cli", "alt"];
			agent.bindings.find((binding: { id: string }) => binding.id === "owner")!.stream = false;
			agent.bindings.push({
				id: "guest",
				match: { channel: "guest", from: "stranger" },
				session: { mode: "persistent", per: "conv" },
				profile: "guest",
			});
			await writeFile(file, stringify(agent));
			await mkdir(`${home}/agents/helper`);
			await writeFile(
				`${home}/agents/helper/agent.yaml`,
				stringify({
					schema: 1,
					id: "helper",
					name: "helper",
					owner: "person:owner",
					defaultProfile: "answer",
					profiles: { answer: { model: "openai/gpt-6-luna", level: "readonly", tools: { offer: [], search: [] } } },
					bindings: [
						{
							id: "internal",
							match: { channel: "agent", kind: "agent" },
							session: "ephemeral",
							profile: "answer",
							reply: "none",
						},
					],
				}),
			);
			kernel = await openKernel(home);
			const running = kernel;
			const connect = async (channel: string) => {
				const socket = createConnection(`${home}/.yonder/plugins/channel-cli/${channel}.sock`);
				sockets.push(socket);
				const packets: Array<{ type: string; text?: string; event?: YEvent }> = [];
				createInterface({ input: socket }).on("line", (line) => packets.push(JSON.parse(line)));
				await new Promise<void>((done, reject) => {
					socket.once("connect", done);
					socket.once("error", reject);
				});
				return { socket, packets };
			};
			const [cli, alt, guest] = await Promise.all([connect("cli"), connect("alt"), connect("guest")]);
			const submit = async (client: typeof cli, text: string) => {
				const start = client.packets.length;
				client.socket.write(`\u001e${JSON.stringify({ type: "input", text })}\n`);
				await expect
					.poll(() => client.packets.slice(start).find((p) => p.type === "accepted"), { timeout: 5000 })
					.toBeTruthy();
				const event = client.packets.slice(start).find((p) => p.type === "accepted")!.event!;
				await expect
					.poll(
						async () =>
							(await running.events.query({ type: "run.end", after: event.id })).events.find(
								(e) => e.parent === event.id,
							),
						{ timeout: 60000 },
					)
					.toBeTruthy();
				await expect
					.poll(() => client.packets.slice(start).find((p) => p.type === "message"), { timeout: 5000 })
					.toBeTruthy();
				return { event, text: client.packets.slice(start).find((p) => p.type === "message")!.text! };
			};
			// Concurrent inputs to one session are merged into a single run by default (D49); one run each needs sequence.
			const a = await submit(cli, "Reply exactly p5-owner-alpha. Do not call tools.");
			const b = await submit(alt, "Reply exactly p5-owner-beta. Do not call tools.");
			expect([a.text, b.text]).toEqual(["p5-owner-alpha", "p5-owner-beta"]);
			const mainSession = a.event.routes?.[0]?.session;
			if (!mainSession) throw new Error("Native owner input has no session route");
			expect(mainSession).toBe(b.event.routes?.[0]?.session);
			const visitor = await submit(guest, "Reply exactly p5-guest. Do not call tools.");
			expect(visitor.event.routes?.[0]?.session).not.toBe(a.event.routes?.[0]?.session);
			const policy = (await manageHome(home, { action: "inspect", profile: "guest" })) as {
				tools: Array<{ name: string; exposure: string }>;
			};
			expect(policy.tools.find((t) => t.name === "write")?.exposure).toBe("capability-denied");
			const asked = await submit(
				cli,
				'Call agent_ask exactly once with agent helper, text "Reply exactly p5-helper." Then reply with its answer.',
			);
			expect(asked.text).toContain("p5-helper");
			const calls = (await kernel.events.query({ type: "message.in" })).events.filter(
				(e) => e.conv === "conv:agent:main",
			);
			expect(calls).toHaveLength(1);
			expect(calls[0]?.routes).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ agent: "main", dropped: "no-binding" }),
					expect.objectContaining({ agent: "helper", wake: "run" }),
				]),
			);
			await submit(
				cli,
				'Use write to create skills/p5-review/SKILL.md with content "---\\nname: p5-review\\ndescription: Verify P5 acceptance evidence.\\n---\\nWhen invoked, reply p5-skill-loaded.\\n" (write actual newlines). Then reply p5-skill-created.',
			);
			expect(await readFile(`${home}/agents/main/skills/p5-review/SKILL.md`, "utf8")).toContain("name: p5-review");
			const viewed = await submit(
				cli,
				"Find p5-review in the available skills index, use skill_view to read it, then follow it.",
			);
			expect(viewed.text).toContain("p5-skill-loaded");
			const transcript = await kernel.sessions.transcript(mainSession);
			expect(transcript.some((e) => e.tools?.some((t) => t.name === "skill_view"))).toBe(true);
			const sent = await submit(
				cli,
				"Call message_send exactly once with to conv:alt:local and text p5-explicit-delivery. Then reply p5-sent.",
			);
			expect(sent.text).toContain("p5-sent");
			expect(alt.packets.some((p) => p.type === "message" && p.text === "p5-explicit-delivery")).toBe(true);
			await writeFile(
				"/tmp/yonder-p5-native-receipt.json",
				JSON.stringify({
					session: mainSession,
					events: [a.event, b.event, visitor.event, asked.event, viewed.event, sent.event],
					tools: transcript.flatMap((entry) => entry.tools ?? []).map((tool) => tool.name),
					model: "openai/gpt-6-luna",
				}),
				{ mode: 0o600 },
			);
			console.info(
				JSON.stringify({
					check: "p5-native-channels",
					events: [a.event.id, b.event.id, visitor.event.id, asked.event.id, viewed.event.id, sent.event.id],
					session: mainSession,
					model: "openai/gpt-6-luna",
				}),
			);
		} finally {
			for (const socket of sockets) socket.destroy();
			await kernel?.close();
			await rm(home, { recursive: true, force: true });
		}
	},
	240000,
);
