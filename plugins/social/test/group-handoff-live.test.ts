import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ChannelIO, YEvent } from "@yonder/sdk";
import { expect, test } from "vitest";
import { stringify } from "yaml";
import { openKernel } from "../../../packages/core/src/kernel/index.js";
import { groupInstructions as cardInstructions } from "../../channel-card/src/setup.js";
import { groupInstructions as qqInstructions } from "../../channel-qq/src/participation.js";

const auth = process.env.YONDER_GROUP_AUTH_SOURCE ?? process.env.YONDER_TEST_AUTH ?? resolve(".yonder/auth.json");
const enabled = process.env.YONDER_TEST_REAL === "1" && existsSync(auth);

test.skipIf(!enabled).each(["other Bot assignment", "authorized owner handoff"])(
	"real Luna %s",
	async (scenario) => {
		const home = await mkdtemp("/tmp/yonder-group-handoff-live-");
		const key = `group-handoff-${randomUUID()}`;
		const globals = globalThis as unknown as Record<string, { ios: Record<string, ChannelIO>; sent: string[] }>;
		let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
		try {
			await mkdir(join(home, "probe"));
			await mkdir(join(home, "agents/main"), { recursive: true });
			await mkdir(join(home, "agents/gpt-senpai"), { recursive: true });
			await writeFile(
				join(home, "probe/package.json"),
				JSON.stringify({
					name: "group-handoff-probe",
					version: "1.0.0",
					type: "module",
					yonder: { apiVersion: 1, id: "handoff-probe", entry: "index.mjs", contributes: { channels: ["handoff"] } },
				}),
			);
			await writeFile(
				join(home, "probe/index.mjs"),
				`export default {
  setup(api) {
    const state={ios:{},sent:[]};
    globalThis[${JSON.stringify(key)}]=state;
    api.channels.register({
      type:'handoff',
      create(id) {
        return {
          id,kinds:['group'],output:{stream:false,attachments:false},
          async start(io){state.ios[id]=io},async stop(){},
          async send(to,msg){state.sent.push(msg.text);return {ok:true,id:'local-'+state.sent.length}}
        };
      }
    });
  }
}`,
			);
			await writeFile(
				join(home, "yonder.yaml"),
				stringify({
					schema: 1,
					defaultModel: "openai/gpt-6-luna",
					credentials: auth,
					plugins: [
						{
							use: resolve("plugins/social"),
							config: {
								groupJudge: {
									preset: "group-judge",
									conversations: ["conv:qq:group:handoff", "conv:card:group:handoff"],
									initialRules: { main: { keywords: ["代码", "贾维斯"], count: 20 } },
								},
							},
						},
						{ use: "./probe" },
					],
					channels: { qq: { type: "handoff" }, card: { type: "handoff" } },
					identity: { persons: [{ id: "owner", name: "Owner", accounts: ["acct:qq:owner", "acct:card:owner"] }] },
					agents: [
						{ id: "main", workspace: "./agents/main" },
						{ id: "gpt-senpai", workspace: "./agents/gpt-senpai" },
					],
				}),
			);
			const shared = {
				model: "openai/gpt-6-luna",
				cheap: "openai/gpt-6-luna",
				plugins: [],
				contexts: [],
				skills: [],
				capabilities: [],
			};
			await writeFile(
				join(home, "agents/main/agent.yaml"),
				stringify({
					schema: 1,
					id: "main",
					name: "贾维斯",
					owner: "person:owner",
					defaultProfile: "group",
					profiles: {
						group: {
							...shared,
							tools: { offer: ["parent_ask", "message_send"], search: [] },
							plugins: ["social"],
							instructions: qqInstructions,
						},
						cardGroup: {
							...shared,
							plugins: ["social"],
							instructions: cardInstructions,
							tools: { offer: ["parent_ask", "message_send"], search: [] },
						},
						owner: { ...shared, tools: { offer: [], search: [] } },
					},
					social: {
						enabled: true,
						scope: ["conv:qq:group:handoff", "conv:card:group:handoff"],
						authorized: { conversations: ["conv:qq:group:handoff", "conv:card:group:handoff"] },
						defaults: { group: { mode: "batch", batch: { run: true, delaySeconds: 3 }, minIntervalSeconds: 30 } },
					},
					bindings: [
						{
							id: "parent",
							match: { channel: "agent", kind: "parent-request" },
							session: "main",
							profile: "owner",
							reply: "none",
						},
						{
							id: "groups",
							match: { channel: "qq", kind: "group" },
							session: { mode: "persistent", per: "conv" },
							profile: "group",
							wake: "mention",
							reply: "none",
						},
						{
							id: "card-group",
							match: { channel: "card", kind: "group" },
							session: { mode: "persistent", per: "conv" },
							profile: "cardGroup",
							wake: "mention",
							reply: "none",
						},
						{
							id: "group-batch",
							match: { type: "social.batch-ready", channel: "qq" },
							session: { mode: "persistent", per: "conv" },
							profile: "group",
							reply: "none",
						},
						{
							id: "card-batch",
							match: { type: "social.batch-ready", channel: "card" },
							session: { mode: "persistent", per: "conv" },
							profile: "cardGroup",
							reply: "none",
						},
					],
				}),
			);
			await writeFile(
				join(home, "agents/gpt-senpai/agent.yaml"),
				stringify({
					schema: 1,
					id: "gpt-senpai",
					name: "GPT学姐",
					owner: "person:owner",
					defaultProfile: "owner",
					profiles: { owner: { ...shared, tools: { offer: [], search: [] } } },
					bindings: [],
				}),
			);
			kernel = await openKernel(home);
			const active = kernel;
			const probe = globals[key];
			const qq = probe?.ios.qq;
			const card = probe?.ios.card;
			if (!probe || !qq || !card) throw Error("Local recording channels were not started");
			const waitFor = async (input: YEvent) => {
				await expect
					.poll(
						async () =>
							(await active.events.query({ type: "run.end", after: input.id })).events.find(
								(e) => e.parent === input.id,
							),
						{ timeout: 120000, interval: 500 },
					)
					.toMatchObject({ data: { status: "done" } });
			};
			if (scenario === "other Bot assignment") {
				const other = await qq.emit({
					type: "message.in",
					from: "acct:qq:owner",
					conv: "conv:qq:group:handoff",
					data: {
						kind: "group",
						msgId: randomUUID(),
						text: "GPT学姐，请你负责代码开发，修复刚才讨论的群聊问题。",
					},
				});
				await expect
					.poll(
						async () =>
							(
								await active.events.query({ type: "social.rule-match", conv: "conv:qq:group:handoff", after: other.id })
							).events.find((e) => (e.data as { sourceEvents?: string[] }).sourceEvents?.includes(other.id)),
						{ timeout: 10000 },
					)
					.toMatchObject({ data: { matched: false } });
				console.log(
					JSON.stringify({
						scenario,
						runs: (await active.events.query({ type: "run.end" })).events.map((e) => e.data),
					}),
				);
				expect(probe.sent).toEqual([]);
				expect(
					(await active.events.query({ type: "message.in" })).events.filter(
						(e) => (e.data as { kind?: string }).kind === "parent-request",
					),
				).toEqual([]);
				return;
			}
			const requestText = "贾维斯，请交给你的主工作会话计算31×17，并返回计算结果。我明确授权这次计算，不做其他工作。";
			const own = await card.emit({
				type: "message.in",
				from: "acct:card:owner",
				conv: "conv:card:group:handoff",
				data: { kind: "group", text: requestText, msgId: randomUUID(), mentioned: true },
			});
			await waitFor(own);
			console.log(
				JSON.stringify({ scenario, runs: (await active.events.query({ type: "run.end" })).events.map((e) => e.data) }),
			);
			const requests = (await active.events.query({ type: "message.in" })).events.filter(
				(e) => (e.data as { kind?: string }).kind === "parent-request",
			);
			expect(requests).toHaveLength(1);
			expect(requests[0]?.parent).toBe(own.id);
			const mainSession = requests[0]?.routes?.find((r) => r.session)?.session;
			if (!mainSession) throw Error("Parent request did not reach a resident session");
			const mainTranscript = JSON.stringify(await active.sessions.transcript(mainSession));
			expect(mainTranscript).toContain(requestText);
			expect(mainTranscript).toContain(own.id);
			expect((await active.events.query({ type: "outsider.rejected", after: own.id })).events).toEqual([]);
			const groupSession = own.routes?.find((r) => r.session)?.session;
			if (groupSession) {
				const visible = (await active.sessions.transcript(groupSession))
					.filter((entry) => entry.kind === "pi.assistant")
					.map((entry) => ({ text: entry.text, tools: entry.tools?.map((tool) => tool.name) }));
				console.log(JSON.stringify({ groupVisible: visible }));
			}
			expect(probe.sent.join("\n")).toContain("527");
			expect(probe.sent.join("\n")).not.toMatch(/是否.*(?:确认|授权)|请.*(?:确认|授权)/);
			console.log(
				JSON.stringify({
					evidence: "real Luna; real kernel and parent_ask; local recording transport, not platform acceptance",
					runs: (await active.events.query({ type: "run.end" })).events.map((e) => e.data),
				}),
			);
			console.log(
				`Real Luna local-transport acceptance: owner=${own.id} parent=${requests[0]?.id}; no platform messages sent`,
			);
		} finally {
			await kernel?.close();
			delete globals[key];
			await rm(home, { recursive: true, force: true });
		}
	},
	300000,
);
