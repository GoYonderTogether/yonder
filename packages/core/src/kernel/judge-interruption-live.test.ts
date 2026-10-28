import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { initHome, openKernel } from "./index.js";

test.skipIf(process.env.YONDER_JUDGE_REAL !== "1")(
	"real judge resumes after an interrupted model request",
	async () => {
		const home = await mkdtemp("/tmp/yonder-ch03r4-live-");
		let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
		let calls = 0;
		const server = createServer(async (req, res) => {
			const chunks: Buffer[] = [];
			for await (const chunk of req) chunks.push(Buffer.from(chunk));
			calls++;
			if (calls === 1) return;
			try {
				const headers = new Headers();
				for (const [name, value] of Object.entries(req.headers))
					if (value && !["host", "connection", "content-length"].includes(name)) headers.set(name, String(value));
				const response = await fetch(`https://api.siliconflow.cn${req.url}`, {
					method: "POST",
					headers,
					body: Buffer.concat(chunks),
				});
				res.writeHead(response.status, { "content-type": response.headers.get("content-type") ?? "text/event-stream" });
				if (response.body)
					Readable.fromWeb(response.body)
						.on("error", () => res.destroy())
						.pipe(res);
				else res.end();
			} catch {
				res.destroy();
			}
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address() as { port: number };
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
			config.plugins.push({ use: "./probe" });
			config.plugins.push({ use: fileURLToPath(new URL("../../../../plugins/social", import.meta.url)) });
			config.channels.ch03r4 = { type: "ch03r4" };
			config.models = {
				providers: {
					siliconflow: {
						baseUrl: `http://127.0.0.1:${address.port}/v1`,
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
			await writeFile(join(home, "presets/judge.yaml"), "schema: 1\ndescription: judge\n");
			agent.bindings = agent.bindings.filter((binding: { id: string }) => binding.id !== "onboarding");
			agent.social = {
				enabled: true,
				authorized: { conversations: ["conv:ch03r4:group", "conv:ch03r4:batch"] },
				defaults: { group: { mode: "mention" } },
				conversations: { "conv:ch03r4:batch": { mode: "batch", batch: { count: 2 }, judge: { preset: "judge" } } },
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
			const input = (msgId: string, text: string, mentioned: boolean) => ({
				type: "message.in",
				from: "acct:ch03r4:user",
				conv: "conv:ch03r4:group",
				data: { kind: "group", msgId, text, mentioned },
			});
			const batchInput = (msgId: string) => ({
				...input(msgId, "群聊中的一条消息。", false),
				conv: "conv:ch03r4:batch",
			});
			await globals[key]!.emit(batchInput("batch-1"));
			await kernel.close();
			kernel = await openKernel(home);
			await globals[key]!.emit(batchInput("batch-2"));
			await expect.poll(() => calls, { timeout: 60000 }).toBe(1);
			const startsBefore = (await kernel.events.query({ type: "social.judge-start" })).events;
			expect(startsBefore).toHaveLength(1);
			expect((await kernel.events.query({ type: "social.judge-result" })).events).toHaveLength(0);
			await kernel.close();
			kernel = await openKernel(home);
			await expect.poll(() => calls, { timeout: 60000 }).toBeGreaterThanOrEqual(2);
			await expect
				.poll(
					async () =>
						(await kernel!.events.query({ type: "social.batch-read", conv: "conv:ch03r4:batch" })).events.length,
					{ timeout: 90000 },
				)
				.toBe(1);
			const batches = (await kernel.events.query({ type: "social.batch-ready", conv: "conv:ch03r4:batch" })).events;
			expect(batches.length).toBeLessThanOrEqual(1);
			const judgments = (await kernel.events.query({ type: "social.judge-result" })).events;
			expect(judgments).toHaveLength(1);
			const starts = (await kernel.events.query({ type: "social.judge-start" })).events;
			expect(starts).toHaveLength(1);
			const session = (starts[0]!.data as { session: string }).session;
			expect(session).toBe((startsBefore[0]!.data as { session: string }).session);
			expect(
				(await kernel.events.query({ type: "session.input" })).events.filter(
					(event) => (event.data as { session?: string }).session === session,
				),
			).toHaveLength(1);
			expect(
				(await kernel.events.query({ type: "run.end" })).events.filter(
					(event) =>
						(event.data as { session?: string; status?: string }).session === session &&
						(event.data as { status?: string }).status === "done",
				),
			).toHaveLength(1);
			const transcript = await kernel.sessions.transcript(session);
			expect(transcript.every((item) => !item.tools?.length)).toBe(true);
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
			expect((await kernel.events.query({ type: "social.judge-result" })).events).toHaveLength(1);
		} finally {
			await kernel?.close();
			delete globals[key];
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
			await rm(home, { recursive: true, force: true });
		}
	},
	300000,
);
