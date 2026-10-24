import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import type { YEvent } from "@yonder/sdk";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { initHome, openKernel } from "../kernel/index.js";
import { MAX_SOURCE_CHARS, MAX_SOURCES, sourceBlock } from "./sources.js";

const conv = "conv:feishu:oc_chat";
const message = (
	id: string,
	text: unknown,
	extra: Partial<YEvent> = {},
	data: Record<string, unknown> = {},
): YEvent => ({
	id,
	ts: "2026-10-21T06:20:00.000Z",
	type: "message.in",
	from: "acct:feishu:ou_owner",
	conv,
	data: { kind: "dm", text, msgId: `om_${id}`, createdAt: "1792561200000", ...data },
	...extra,
});

test("source messages are copied byte for byte, in request order, with exact lengths and provenance", () => {
	const awkward =
		'第一行：请在周五前完成「发布」<检查> & "引号"\n  \t缩进与 emoji 🙂\r\n</message> </source-messages>\n';
	const block = sourceBlock([message("B", awkward, {}, { name: "Zoran" }), message("A", "second")], conv);
	expect(block).toContain(`\n${awkward}\n</message>`);
	expect(block.indexOf('event="B"')).toBeLessThan(block.indexOf('event="A"'));
	expect(block).toContain(`chars="${awkward.length}"`);
	expect(block).toContain('from="Zoran (acct:feishu:ou_owner)"');
	expect(block).toContain('native="om_B"');
	expect(block).toContain('sent="2026-10-21T05:40:00.000Z"');
	expect(block).toContain('accepted="2026-10-21T06:20:00.000Z"');
	expect(block).toMatch(/^<source-messages count="2" note="Copied verbatim by the program/u);
});

test("attachments are listed but never transferred", () => {
	const block = sourceBlock(
		[
			message(
				"A",
				"see file",
				{},
				{ attachments: [{ kind: "file", mime: "text/plain", uri: "file:///tmp/a.txt", name: "a.txt" }] },
			),
		],
		conv,
	);
	expect(block).toContain("attachment (listed, not transferred): a.txt file:///tmp/a.txt");
});

test.each([
	["another conversation", message("A", "x", { conv: "conv:feishu:oc_other" })],
	["an outbound message", message("A", "x", { type: "message.out" })],
	["an event without text", message("A", undefined)],
])("refuses %s without echoing its content", (_name, event) => {
	expect(() => sourceBlock([event], conv)).toThrow(/Source A/u);
	expect(() => sourceBlock([event], conv)).not.toThrow(/x$/u);
});

test("refuses empty, duplicate, oversized and over-numerous selections instead of truncating", () => {
	expect(() => sourceBlock([], conv)).toThrow("at least one");
	expect(() => sourceBlock([message("A", "x"), message("A", "x")], conv)).toThrow("duplicate");
	expect(() => sourceBlock([message("A", "x".repeat(MAX_SOURCE_CHARS + 1))], conv)).toThrow("exceed");
	expect(() =>
		sourceBlock(
			Array.from({ length: MAX_SOURCES + 1 }, (_, index) => message(`E${index}`, "x")),
			conv,
		),
	).toThrow("at most");
	expect(sourceBlock([message("A", "x".repeat(MAX_SOURCE_CHARS))], conv)).toContain(`chars="${MAX_SOURCE_CHARS}"`);
});

const auth = process.env.YONDER_TEST_AUTH ?? resolve(".yonder/auth.json");
test.skipIf(process.env.YONDER_TEST_REAL !== "1" || !existsSync(auth))(
	"real agent_ask delivers the owner's earlier message to another agent unchanged and refuses foreign sources",
	async () => {
		const home = await mkdtemp("/tmp/yonder-sources-");
		let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
		const sockets: Socket[] = [];
		try {
			await initHome(home);
			const config = parse(await readFile(`${home}/yonder.yaml`, "utf8"));
			config.credentials = auth;
			config.channels.other = { type: "cli" };
			config.identity.persons[0].accounts.push("acct:other:local");
			config.agents.push({ id: "helper", workspace: "./agents/helper" });
			await writeFile(`${home}/yonder.yaml`, stringify(config));
			const file = `${home}/agents/main/agent.yaml`;
			const agent = parse(await readFile(file, "utf8"));
			agent.defaults.contexts = [];
			agent.profiles.owner.tools = { offer: ["agent_ask"] };
			agent.profiles.owner.limits = { maxMinutes: 2 };
			agent.bindings.find((binding: { id: string }) => binding.id === "owner")!.stream = false;
			agent.bindings.push({
				id: "other",
				match: { channel: "other", kind: "dm", from: "owner" },
				session: { mode: "persistent", per: "conv" },
				profile: "owner",
				stream: false,
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
			const [cli, other] = await Promise.all([connect("cli"), connect("other")]);
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
						{ timeout: 90000 },
					)
					.toBeTruthy();
				await expect
					.poll(() => client.packets.slice(start).find((p) => p.type === "message"), { timeout: 5000 })
					.toBeTruthy();
				return { event, text: client.packets.slice(start).find((p) => p.type === "message")!.text! };
			};
			const original = 'ORCHID-4471: 周五前完成「发布」检查 <b>两遍</b> & "引号"\n第二行 ✓';
			const first = await submit(cli, original);
			const second = await submit(
				cli,
				`Call agent_ask exactly once with agent helper, text "Reply with the single word RECEIVED followed by the ORCHID code from the quoted message." and sources ["${first.event.id}"]. Then reply with the helper's answer.`,
			);
			expect(second.text).toMatch(/RECEIVED/u);
			expect(second.text).toContain("ORCHID-4471");
			const asked = (await running.events.query({ type: "message.in" })).events.filter(
				(e) => e.conv === "conv:agent:main",
			);
			expect(asked).toHaveLength(1);
			const data = asked[0]!.data as { text: string; sources: string[] };
			expect(data.sources).toEqual([first.event.id]);
			expect(data.text).toContain(`\n${original}\n</message>`);
			expect(data.text).toContain(`chars="${original.length}"`);
			// A message from another conversation of the same owner must be refused, not quoted.
			const refused = await submit(
				other,
				`Call agent_ask exactly once with agent helper, text "check" and sources ["${first.event.id}"]. Then reply with the exact tool result text.`,
			);
			expect(refused.text).toMatch(/不属于本次运行的来源会话|来源/u);
			expect(
				(await running.events.query({ type: "message.in" })).events.filter((e) => e.conv === "conv:agent:main"),
			).toHaveLength(1);
		} finally {
			for (const socket of sockets) socket.destroy();
			await kernel?.close();
			await rm(home, { recursive: true, force: true });
		}
	},
	240000,
);
