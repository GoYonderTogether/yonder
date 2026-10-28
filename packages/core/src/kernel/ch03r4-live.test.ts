import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { initHome, openKernel } from "./index.js";

test.skipIf(process.env.YONDER_CH03R4_REAL !== "1")(
	"mention replay and completed social batches are not repeated after restart",
	async () => {
		const home = await mkdtemp("/tmp/yonder-ch03r4-live-");
		let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
		let stage = "setup";
		let failed = false;
		let closeFailed = false;
		const key = `ch03r4-${home}`;
		const globals = globalThis as unknown as Record<
			string,
			{ emit: (event: unknown) => Promise<unknown>; sent: string[] }
		>;
		try {
			await initHome(home, "owner", { model: "siliconflow/deepseek-ai/DeepSeek-V3.2" });
			const sourcePath = process.env.YONDER_CH03R4_AUTH_SOURCE;
			if (!sourcePath) throw Error("YONDER_CH03R4_AUTH_SOURCE is required");
			const source = JSON.parse(await readFile(sourcePath, "utf8"));
			if (source.siliconflow?.type !== "api_key" || typeof source.siliconflow.key !== "string")
				throw Error("siliconflow slot unavailable");
			const auth = join(home, "auth.json");
			await writeFile(auth, JSON.stringify({ siliconflow: source.siliconflow }), { mode: 0o600 });
			await mkdir(join(home, "probe"));
			await writeFile(
				join(home, "probe/package.json"),
				JSON.stringify({
					name: "ch03r4-probe",
					version: "1.0.0",
					type: "module",
					yonder: { apiVersion: 1, id: "ch03r4-probe", entry: "index.mjs", contributes: { channels: ["ch03r4"] } },
				}),
			);
			await writeFile(
				join(home, "probe/index.mjs"),
				`export default {setup(api){api.channels.register({type:'ch03r4',create(id){return {id,kinds:['group'],output:{stream:false,attachments:false},async start(io){globalThis[${JSON.stringify(key)}]={emit:io.emit,sent:globalThis[${JSON.stringify(key)}]?.sent??[]}},async stop(){},async send(to,message){globalThis[${JSON.stringify(key)}].sent.push(message.text);return {ok:true}}}}})}}`,
			);
			const config = parse(await readFile(join(home, "yonder.yaml"), "utf8"));
			config.credentials = auth;
			config.notifications = { outbound: { mode: "immediate" } };
			config.plugins.push({ use: "./probe" });
			config.plugins.push({ use: fileURLToPath(new URL("../../../../plugins/social", import.meta.url)) });
			config.channels.ch03r4 = { type: "ch03r4" };
			config.models = {
				providers: {
					siliconflow: {
						baseUrl: "https://api.siliconflow.cn/v1",
						api: "openai-completions",
						authHeader: true,
						models: [
							{
								id: "deepseek-ai/DeepSeek-V3.2",
								name: "DeepSeek V3.2",
								input: ["text"],
								contextWindow: 131072,
								maxTokens: 8192,
							},
						],
					},
				},
			};
			await writeFile(join(home, "yonder.yaml"), stringify(config));
			const agentPath = join(home, "agents/main/agent.yaml");
			const agent = parse(await readFile(agentPath, "utf8"));
			agent.defaults.plugins = agent.defaults.plugins.filter((id: string) => id !== "onboarding" && id !== "tasks");
			agent.defaults.contexts = [];
			agent.defaults.cheap = "siliconflow/deepseek-ai/DeepSeek-V3.2";
			delete agent.profiles[agent.defaultProfile].level;
			agent.profiles[agent.defaultProfile].capabilities = ["message"];
			await writeFile(join(home, "presets/judge.yaml"), "schema: 1\ndescription: judge\n");
			agent.bindings = agent.bindings.filter((binding: { id: string }) => binding.id !== "onboarding");
			agent.social = {
				enabled: true,
				authorized: { conversations: ["conv:ch03r4:group", "conv:ch03r4:batch", "conv:ch03r4:chatter"] },
				defaults: { group: { mode: "mention" } },
				conversations: {
					"conv:ch03r4:batch": { mode: "batch", batch: { count: 2 }, judge: { preset: "judge" } },
					"conv:ch03r4:chatter": { mode: "batch", batch: { count: 2, delaySeconds: 3600 }, judge: { preset: "judge" } },
				},
			};
			agent.bindings.push({
				id: "batch",
				match: { type: "social.batch-ready" },
				session: { mode: "persistent", per: "conv" },
				reply: "none",
			});
			agent.bindings.push({
				id: "group",
				match: { channel: "ch03r4", kind: "group" },
				session: { mode: "persistent", per: "conv" },
			});
			await writeFile(agentPath, stringify(agent));
			kernel = await openKernel(home);
			stage = "group mention";
			const input = (msgId: string, text: string, mentioned: boolean) => ({
				type: "message.in",
				from: "acct:ch03r4:user",
				conv: "conv:ch03r4:group",
				data: { kind: "group", msgId, text, mentioned },
			});
			stage = "chatter accumulation";
			await globals[key]!.emit({ ...input("batch-chatter", "今天天气不错。", false), conv: "conv:ch03r4:chatter" });
			const accumulated = (await kernel.events.query({ type: "message.in", conv: "conv:ch03r4:chatter" })).events;
			expect(accumulated).toHaveLength(1);
			expect(accumulated[0]!.routes?.[0]).toMatchObject({ wake: "write" });
			const decision = (await kernel.events.query({ type: "routing.social-decision" })).events.find(
				(event) => event.parent === accumulated[0]!.id,
			);
			expect(decision?.data).toMatchObject({ reason: "batch" });
			expect(
				(await kernel.events.query({ type: "social.batch-read", conv: "conv:ch03r4:chatter" })).events,
			).toHaveLength(0);
			expect(
				(await kernel.events.query({ type: "social.judge-start", conv: "conv:ch03r4:chatter" })).events,
			).toHaveLength(0);
			expect((await kernel.events.query({ type: "run.end" })).events).toHaveLength(0);
			stage = "group mention";
			await globals[key]!.emit(input("chatter", "今天的天气不错。", false));
			const chatter = (await kernel.events.query({ type: "message.in", conv: "conv:ch03r4:group" })).events[0]!;
			expect(chatter.routes?.[0]?.dropped).toBe("no-binding");
			expect((await kernel.events.query({ type: "run.end" })).events).toHaveLength(0);
			expect(globals[key]!.sent).toHaveLength(0);
			const mention = input("mention", "请简短回复你好。", true);
			await globals[key]!.emit(mention);
			await expect.poll(() => globals[key]!.sent.length, { timeout: 90000 }).toBeGreaterThan(0);
			const events = (await kernel.events.query({ type: "message.in", conv: "conv:ch03r4:group" })).events;
			const mentioned = events.find((event) => (event.data as { msgId?: string }).msgId === "mention")!;
			expect(mentioned.routes?.[0]?.wake).toBe("run");
			await expect
				.poll(
					async () =>
						(await kernel!.events.query({ type: "run.end" })).events.some(
							(event) => event.parent === mentioned.id && (event.data as { status?: string }).status === "done",
						),
					{ timeout: 90000 },
				)
				.toBe(true);
			const sent = globals[key]!.sent.length;
			const runs = (await kernel.events.query({ type: "run.end" })).events.length;
			await kernel.close();
			kernel = await openKernel(home);
			await globals[key]!.emit(mention);
			await new Promise((resolve) => setTimeout(resolve, 2000));
			expect((await kernel.events.query({ type: "message.in", conv: "conv:ch03r4:group" })).events).toHaveLength(2);
			expect((await kernel.events.query({ type: "run.end" })).events).toHaveLength(runs);
			expect(globals[key]!.sent).toHaveLength(sent);

			stage = "owner notification";
			const main = await kernel.bots.send("main", "请简短回复你好。");
			await expect
				.poll(
					async () =>
						(await kernel!.events.query({ type: "run.end" })).events.some(
							(event) => event.parent === main.event && (event.data as { status?: string }).status === "done",
						),
					{ timeout: 90000 },
				)
				.toBe(true);
			const ownerMention = {
				...input("owner-mention", "@主人，请留意。", false),
				data: { kind: "group", msgId: "owner-mention", text: "@主人，请留意。", social: { mentions: { owner: true } } },
			};
			await globals[key]!.emit(ownerMention);
			const ownerEvent = (await kernel.events.query({ type: "message.in", conv: "conv:ch03r4:group" })).events.find(
				(event) => (event.data as { msgId?: string }).msgId === "owner-mention",
			)!;
			expect(ownerEvent.routes?.[0]?.wake).toBe("write");
			await expect
				.poll(async () => (await kernel!.events.query({ type: "notification.intent" })).events.length)
				.toBe(1);
			const intent = (await kernel.events.query({ type: "notification.intent" })).events[0]!;
			expect(intent.data).toMatchObject({
				notification: { key: `owner-mention:${ownerEvent.id}`, sourceEvents: [ownerEvent.id] },
			});
			await kernel.close();
			kernel = await openKernel(home);
			await expect.poll(async () => (await kernel!.events.query({ type: "notification.final" })).events.length).toBe(1);
			const final = (await kernel.events.query({ type: "notification.final" })).events[0]!;
			expect(final.data).toMatchObject({ intents: [intent.id], status: "attempted" });
			await expect
				.poll(
					async () =>
						(await kernel!.sessions.transcript(main.session)).filter(
							(item) => item.kind === "yonder.notification" && item.event === intent.id,
						).length,
				)
				.toBe(1);
			expect(
				(await kernel.sessions.transcript(main.session)).find(
					(item) => item.kind === "yonder.notification" && item.event === intent.id,
				),
			).toMatchObject({ event: intent.id, text: "群消息提及了主人：conv:ch03r4:group" });
			await kernel.close();
			kernel = await openKernel(home);
			await globals[key]!.emit(ownerMention);
			await new Promise((resolve) => setTimeout(resolve, 2000));
			expect((await kernel.events.query({ type: "notification.intent" })).events).toHaveLength(1);
			expect((await kernel.events.query({ type: "notification.final" })).events).toHaveLength(1);
			expect(
				(await kernel.sessions.transcript(main.session)).filter(
					(item) => item.kind === "yonder.notification" && item.event === intent.id,
				),
			).toHaveLength(1);

			stage = "social batch";
			const batchInput = (msgId: string) => ({
				...input(
					msgId,
					msgId === "batch-1" ? "群里的机器人能帮忙查一下明天的天气吗？" : "机器人查到结果后请告诉大家。",
					false,
				),
				conv: "conv:ch03r4:batch",
			});
			await globals[key]!.emit(batchInput("batch-1"));
			await kernel.close();
			kernel = await openKernel(home);
			await globals[key]!.emit(batchInput("batch-2"));
			await expect
				.poll(
					async () =>
						(await kernel!.events.query({ type: "social.batch-read", conv: "conv:ch03r4:batch" })).events.length,
					{ timeout: 90000 },
				)
				.toBe(1);
			const sources = (await kernel.events.query({ type: "message.in", conv: "conv:ch03r4:batch" })).events;
			const ids = sources.map((event) => event.id);
			expect(ids).toHaveLength(2);
			const starts = (await kernel.events.query({ type: "social.judge-start", conv: "conv:ch03r4:batch" })).events;
			const judgments = (await kernel.events.query({ type: "social.judge-result", conv: "conv:ch03r4:batch" })).events;
			expect(starts).toHaveLength(1);
			expect(judgments).toHaveLength(1);
			const judgeSession = (starts[0]!.data as { session: string }).session;
			const judgment = judgments[0]!.data as {
				action: string;
				reason: string;
				through: string;
				sourceEvents: string[];
				batch: { data: { sourceEvents: string[] } };
			};
			expect(starts[0]!.data).toMatchObject({ agent: "main", through: ids[1] });
			expect(judgment).toMatchObject({ through: ids[1], batch: { data: { sourceEvents: ids } } });
			expect(["summarize", "participate"]).toContain(judgment.action);
			expect(typeof judgment.reason).toBe("string");
			expect(judgment.sourceEvents.every((id) => ids.includes(id))).toBe(true);
			const judgeRuns = (await kernel.events.query({ type: "run.end" })).events.filter(
				(event) => (event.data as { session?: string }).session === judgeSession,
			);
			expect(judgeRuns).toHaveLength(1);
			expect(judgeRuns[0]!.data).toMatchObject({ status: "done", model: "siliconflow/deepseek-ai/DeepSeek-V3.2" });
			const judgeInput = (await kernel.events.query({ type: "session.input" })).events.find(
				(event) => (event.data as { session?: string }).session === judgeSession,
			)!;
			const judgeText = (judgeInput.data as { text: string }).text;
			expect(judgeText).toContain(
				JSON.stringify(sources.map((event) => ({ id: event.id, text: (event.data as { text: string }).text }))),
			);
			expect(sources.every((event) => (event.data as { mentioned: boolean }).mentioned === false)).toBe(true);
			expect((judgeRuns[0]!.data as { inputs: string[] }).inputs).toContain(judgeInput.id);
			expect((await kernel.sessions.transcript(judgeSession)).every((item) => !item.tools?.length)).toBe(true);
			const batches = (await kernel.events.query({ type: "social.batch-ready", conv: "conv:ch03r4:batch" })).events;
			expect(batches).toHaveLength(judgment.action === "participate" ? 1 : 0);
			const read = (await kernel.events.query({ type: "social.batch-read", conv: "conv:ch03r4:batch" })).events[0]!;
			expect(read.parent).toBe(judgment.action === "participate" ? batches[0]!.id : judgments[0]!.id);
			const batchRuns = (await kernel.events.query({ type: "run.end" })).events.length;
			await kernel.close();
			kernel = await openKernel(home);
			await globals[key]!.emit(batchInput("batch-1"));
			await globals[key]!.emit(batchInput("batch-2"));
			await new Promise((resolve) => setTimeout(resolve, 2000));
			expect((await kernel.events.query({ type: "message.in", conv: "conv:ch03r4:batch" })).events).toHaveLength(2);
			expect(
				(await kernel.events.query({ type: "social.batch-ready", conv: "conv:ch03r4:batch" })).events,
			).toHaveLength(batches.length);
			expect((await kernel.events.query({ type: "social.batch-read", conv: "conv:ch03r4:batch" })).events).toHaveLength(
				1,
			);
			expect((await kernel.events.query({ type: "run.end" })).events).toHaveLength(batchRuns);
			expect(
				(await kernel.events.query({ type: "social.judge-start", conv: "conv:ch03r4:batch" })).events,
			).toHaveLength(1);
			expect(
				(await kernel.events.query({ type: "social.judge-result", conv: "conv:ch03r4:batch" })).events,
			).toHaveLength(1);
			expect(globals[key]!.sent).toHaveLength(sent);
		} catch (error) {
			failed = true;
			const reason =
				error instanceof Error && error.message === "YONDER_CH03R4_AUTH_SOURCE is required"
					? "auth source missing"
					: error instanceof Error && error.message === "siliconflow slot unavailable"
						? "auth slot unavailable"
						: error instanceof Error && error.name === "AssertionError"
							? "assertion failed"
							: "operation failed";
			const line = error instanceof Error ? error.stack?.match(/ch03r4-live\.test\.ts:(\d+):\d+/)?.[1] : undefined;
			console.error("CH03R4 failure:", { stage, reason, line });
			if (kernel) {
				try {
					for (const type of [
						"social.judge-start",
						"social.judge-result",
						"social.batch-failed",
						"social.batch-ready",
						"social.batch-read",
						"run.end",
					]) {
						const events = (await kernel.events.query({ type })).events;
						const id = (value: unknown) =>
							typeof value === "string" && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value) ? value : undefined;
						console.error(
							type,
							events.map((event) => {
								const data = event.data as { status?: unknown; action?: unknown; through?: unknown };
								return {
									id: id(event.id),
									parent: id(event.parent),
									through: id(data.through),
									status: ["done", "error", "aborted", "limit"].find((value) => value === data.status),
									action: ["ignore", "summarize", "participate"].find((value) => value === data.action),
								};
							}),
						);
					}
				} catch {
					console.error("CH03R4 diagnostics unavailable");
				}
			}
			throw new Error(`CH03R4 ${stage}: ${reason}`);
		} finally {
			try {
				await kernel?.close();
			} catch {
				console.error("CH03R4 service close failed");
				closeFailed = true;
			}
			delete globals[key];
			if (failed || closeFailed) {
				await rm(join(home, "auth.json"), { force: true }).catch(() => {
					console.error("CH03R4 credential cleanup failed");
				});
				console.error("CH03R4 retained home:", home);
			} else {
				await rm(home, { recursive: true, force: true }).catch(async () => {
					await rm(join(home, "auth.json"), { force: true }).catch(() => {
						console.error("CH03R4 credential cleanup failed");
					});
					console.error("CH03R4 retained home:", home);
					throw new Error("CH03R4 temporary home cleanup failed");
				});
			}
		}
		if (closeFailed && !failed) throw new Error("CH03R4 service close failed");
	},
	450000,
);
