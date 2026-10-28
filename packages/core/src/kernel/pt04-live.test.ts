import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { initHome, openKernel } from "./index.js";

test.skipIf(!process.env.YONDER_PT04_AUTH_SOURCE)(
	"supervisor answers CLI while a delegated task continues and delivers to gateway",
	async () => {
		const home = await mkdtemp("/tmp/yonder-pt04-");
		let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
		let socket: Socket | undefined;
		const cli: { text: string; at: number }[] = [];
		try {
			await initHome(home, "owner", { model: "siliconflow/deepseek-ai/DeepSeek-V3.2" });
			const source = JSON.parse(await readFile(process.env.YONDER_PT04_AUTH_SOURCE!, "utf8"));
			if (source.siliconflow?.type !== "api_key" || typeof source.siliconflow.key !== "string")
				throw Error("siliconflow slot unavailable");
			const auth = join(home, "auth.json");
			await writeFile(auth, JSON.stringify({ siliconflow: source.siliconflow }), { mode: 0o600 });
			const config = parse(await readFile(join(home, "yonder.yaml"), "utf8"));
			config.credentials = auth;
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
			agent.defaults.contexts = [];
			agent.profiles.owner.tools = { offer: ["task_run", "bash"], search: [] };
			await writeFile(agentPath, stringify(agent));
			await writeFile(
				join(home, "presets/pt04-child.yaml"),
				stringify({
					schema: 1,
					description: "Delegated execution acceptance",
					instructions:
						"Run the requested command once. If it returns a background handle, end your response and wait for automatic completion. Do not poll, run another command, or repeat the task. After receiving the completion return the actual result.",
					model: "siliconflow/deepseek-ai/DeepSeek-V3.2",
					capabilities: ["read", "exec"],
					tools: { offer: ["bash"], search: [] },
					plugins: [],
					skills: [],
				}),
			);
			kernel = await openKernel(home);
			const active = kernel;
			socket = createConnection(join(home, ".yonder/plugins/channel-cli/cli.sock"));
			createInterface({ input: socket }).on("line", (line) => {
				const part = JSON.parse(line) as { type: string; text?: string };
				if ((part.type === "final" || part.type === "message") && part.text)
					cli.push({ text: part.text, at: Date.now() });
			});
			await new Promise<void>((resolve, reject) => {
				socket!.once("connect", resolve);
				socket!.once("error", reject);
			});
			const sent = await active.bots.send(
				"main",
				"Delegate exactly once using task_run preset pt04-child. The child must run bash exactly once with command 'sleep 45; printf PT04_CHILD_DONE' then return its real output. If a background handle is returned, wait for automatic completion without polling or delegating again. When the result arrives, verify it and deliver PT04_FINAL and the actual output here.",
			);
			let child = "";
			await expect
				.poll(
					async () => {
						const sessions = await active.sessions.list({});
						child = sessions.find((s) => s.parent === sent.session && s.profile === "pt04-child")?.id ?? "";
						if (!child) return false;
						return (await active.sessions.transcript(child)).some((entry) =>
							entry.tools?.some((tool) => tool.name === "bash"),
						);
					},
					{ timeout: 90000, interval: 500 },
				)
				.toBe(true);
			socket.write("Reply exactly PT04_SHORT. The delegated task should continue.\n");
			await expect
				.poll(() => cli.some((entry) => entry.text.includes("PT04_SHORT")), { timeout: 60000, interval: 500 })
				.toBe(true);
			const accepted = (await active.events.query({ type: "message.in", limit: 1000 })).events.find((e) =>
				(e.data as { text?: string }).text?.startsWith("Reply exactly PT04_SHORT"),
			);
			if (!accepted) throw Error("Missing CLI acceptance");
			const first = cli.find((entry) => entry.text.includes("PT04_SHORT"))!.at;
			await expect
				.poll(
					async () => {
						const events = (await active.events.query({ limit: 1000 })).events;
						const background = events.find(
							(e) =>
								e.type === "runtime.tool-result" &&
								(e.data as { session?: string; tool?: string }).session === child &&
								(e.data as { tool?: string }).tool === "bash",
						);
						return (
							!!background &&
							events.some(
								(e) =>
									e.type === "run.end" &&
									(e.data as { session?: string; status?: string }).session === child &&
									(e.data as { status?: string }).status === "done" &&
									Date.parse(e.ts) >= Date.parse(background.ts),
							)
						);
					},
					{ timeout: 90000, interval: 500 },
				)
				.toBe(true);
			const events = (await active.events.query({ limit: 1000 })).events;
			const background = events.find(
				(e) =>
					e.type === "runtime.tool-result" &&
					(e.data as { session?: string; tool?: string }).session === child &&
					(e.data as { tool?: string }).tool === "bash",
			);
			if (!background) throw Error("Missing child background completion");
			const childEnd = events.find(
				(e) =>
					e.type === "run.end" &&
					(e.data as { session?: string }).session === child &&
					Date.parse(e.ts) >= Date.parse(background.ts),
			)!;
			await expect
				.poll(
					async () =>
						(await active.events.query({ type: "message.out", limit: 1000 })).events.some((e) => {
							const data = e.data as { to?: string; text?: string; delivery?: { ok?: boolean } };
							return (
								data.to === "conv:console:main" &&
								!!data.text?.includes("PT04_FINAL") &&
								!!data.text.includes("PT04_CHILD_DONE") &&
								data.delivery?.ok === true
							);
						}),
					{ timeout: 90000, interval: 500 },
				)
				.toBe(true);
			const out = (await active.events.query({ type: "message.out", limit: 1000 })).events.find((e) => {
				const data = e.data as { to?: string; text?: string };
				return data.to === "conv:console:main" && !!data.text?.includes("PT04_FINAL");
			})!;
			const parent = await active.sessions.transcript(sent.session);
			expect(parent.flatMap((entry) => entry.tools ?? []).filter((tool) => tool.name === "task_run")).toHaveLength(1);
			expect(
				(await active.sessions.transcript(child))
					.flatMap((entry) => entry.tools ?? [])
					.filter((tool) => tool.name === "bash"),
			).toHaveLength(1);
			expect(first).toBeLessThan(Date.parse(childEnd.ts));
			const evidence = {
				event: sent.event,
				session: sent.session,
				child,
				handle: (background.data as { job?: string }).job,
				backgroundEvent: background.id,
				input: accepted.id,
				accepted: accepted.ts,
				first: new Date(first).toISOString(),
				childEnd: childEnd.ts,
				delivery: out.ts,
				deliveryEvent: out.id,
			};
			await writeFile(`/tmp/yonder-pt04-evidence-${sent.event}.json`, JSON.stringify(evidence));
			console.log(`PT04 ${JSON.stringify(evidence)}`);
		} finally {
			socket?.destroy();
			await kernel?.close();
			await rm(home, { recursive: true, force: true });
		}
	},
	230000,
);
