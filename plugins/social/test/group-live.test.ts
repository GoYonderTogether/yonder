import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ChannelIO, PluginAPI } from "@yonder/sdk";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { initHome, openKernel } from "../../../packages/core/src/kernel/index.js";
import { openDatabase } from "../../../packages/core/src/runtime/db.js";
import { judgeGroup, speakers } from "../src/group-judge.js";

const authSource = process.env.YONDER_GROUP_AUTH_SOURCE ?? process.env.YONDER_TEST_AUTH;
const enabled = process.env.YONDER_GROUP_REAL === "1" && !!authSource && existsSync(authSource);

test.skipIf(!enabled)(
	"real Luna group judge selects an addressed resident and silences stopped residents through the production judge entry",
	async () => {
		const home = await mkdtemp("/tmp/yonder-group-judge-live-");
		const key = `group-judge-live-${randomUUID()}`;
		const globals = globalThis as unknown as Record<string, { api?: PluginAPI; io?: ChannelIO }>;
		let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
		try {
			const model = "openai/gpt-6-luna";
			await initHome(home, "owner", { model });
			await mkdir(join(home, "probe"));
			await writeFile(
				join(home, "probe/package.json"),
				JSON.stringify({
					name: "group-judge-live-probe",
					version: "1.0.0",
					type: "module",
					yonder: { apiVersion: 1, id: "group-probe", entry: "index.mjs", contributes: { channels: ["group-probe"] } },
				}),
			);
			// Real local transport adapter; sending is forbidden. It never replaces a model/provider.
			await writeFile(
				join(home, "probe/index.mjs"),
				`export default {setup(api){globalThis[${JSON.stringify(key)}]={api};api.channels.register({type:'group-probe',create(id){return {id,kinds:['group'],output:{stream:false,attachments:false},async start(io){globalThis[${JSON.stringify(key)}].io=io},async stop(){},async send(){throw Error('Live judge probe must not send messages')}}}})}}`,
			);
			const configPath = join(home, "yonder.yaml");
			const config = parse(await readFile(configPath, "utf8"));
			// The authorized runtime reads the supplied source directly. No secret/OAuth is copied.
			config.credentials = resolve(authSource ?? "");
			config.plugins.push({ use: "./probe" });
			config.channels = { room: { type: "group-probe" } };
			await writeFile(configPath, stringify(config));
			const agentPath = join(home, "agents/main/agent.yaml");
			const agent = parse(await readFile(agentPath, "utf8"));
			agent.defaultProfile = "group-observer";
			agent.defaults = { model, cheap: model, plugins: [], contexts: [], skills: [] };
			agent.profiles = {
				"group-observer": {
					model,
					cheap: model,
					capabilities: [],
					plugins: [],
					contexts: [],
					skills: [],
					tools: { offer: [], search: [] },
				},
			};
			agent.bindings = [
				{
					id: "group",
					match: { channel: "room", kind: "group" },
					session: { mode: "persistent", per: "conv" },
					profile: "group-observer",
					wake: "write",
					reply: "none",
				},
			];
			await writeFile(agentPath, stringify(agent));
			await writeFile(
				join(home, "presets/group-judge.yaml"),
				"schema: 1\ndescription: Isolated group judgment\ncapabilities: []\nplugins: []\ncontexts: []\nskills: []\ntools: {offer: [], search: []}\n",
			);
			kernel = await openKernel(home);
			const io = globals[key]?.io;
			const api = globals[key]?.api;
			if (!io || !api) throw new Error("Real group adapter was not started");
			const source = await io.emit({
				type: "message.in",
				from: "acct:room:owner",
				conv: "conv:room:public-group",
				data: { kind: "group", msgId: randomUUID(), text: "我们产品得有品味" },
			});
			const sourceSession = source.routes?.find(
				(route) => route.agent === "main" && route.wake === "write" && !route.dropped,
			)?.session;
			if (!sourceSession) throw new Error("No real group source session");
			const candidates = [
				{ agent: "main", name: "贾维斯 / Jarvis", identity: "主人的个人助理", running: false },
				{ agent: "gpt-senpai", name: "GPT 学姐 / GPT", identity: "群中另一位常驻 AI", running: false },
			];
			const direct = await judgeGroup(
				api,
				"group-judge",
				sourceSession,
				{
					previousSilenced: [],
					candidates,
					messages: [
						{
							id: "direct",
							from: "owner",
							text: "<@CDE679AD3F303811BC727C82AE0CBC73> 你先帮我看一下群里另一个同学发的几个文档，windows 相关的，yonder-harness 项目的，你看看你复述一下需求",
							mentions: ["main"],
							mentioned: true,
						},
					],
				},
				["main", "gpt-senpai"],
			);
			console.info("group-judge-live-direct", JSON.stringify(direct));
			expect(speakers(direct)).toEqual(["main"]);
			const stop = await judgeGroup(
				api,
				"group-judge",
				sourceSession,
				{
					previousSilenced: [],
					candidates: candidates.map((candidate) => ({ ...candidate, running: true })),
					messages: [
						{ id: "taste", from: "owner", text: "我们产品得有品味" },
						{ id: "stop", from: "owner", text: "GPT 和 Jarvis 你们两个闭嘴，禁言" },
					],
				},
				["main", "gpt-senpai"],
			);
			console.info("group-judge-live-stop", JSON.stringify(stop));
			expect(speakers(stop)).toEqual([]);
			expect(stop.silenced).toEqual(expect.arrayContaining(["main", "gpt-senpai"]));
			expect(stop.decisions.every((decision) => decision.action === "cancel")).toBe(true);
			const taskSessions = await api.sessions.list({ mode: "task" });
			const database = await openDatabase(join(home, ".yonder/state.db"), true);
			try {
				const rows = await database.all<{ record: string }>("SELECT record FROM pi_entries ORDER BY id");
				const records = rows.map((row) => JSON.parse(row.record));
				const models = records
					.filter((record) => record.kind === "pi.model-observation" && record.data?.phase === "start")
					.map((record) => record.data.selected);
				expect(
					models.some(
						(observed) =>
							observed?.provider === "openai" && (observed.model === "gpt-6-luna" || observed.modelId === "gpt-6-luna"),
					),
				).toBe(true);
				const usage = records.flatMap((record) =>
					record.kind === "pi.model-observation" && record.data?.phase === "end" && record.data?.usage
						? [record.data.usage]
						: [],
				);
				console.info(
					"group-judge-live",
					JSON.stringify({
						source: "local transport; not QQ/Web platform acceptance",
						direct,
						stop,
						models,
						usage,
						judgeSessions: taskSessions.map((session) => session.id),
					}),
				);
			} finally {
				await database.close();
			}
		} finally {
			await kernel?.close();
			delete globals[key];
			await rm(home, { recursive: true, force: true });
		}
	},
	180000,
);
