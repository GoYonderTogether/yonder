import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { initHome, openKernel } from "./index.js";

test.skipIf(!process.env.YONDER_T08_AUTH_SOURCE)(
	"main agent delegates two overlapping child runs",
	async () => {
		const home = await mkdtemp("/tmp/yonder-t08-live-");
		let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
		try {
			await initHome(home, "owner", { model: "siliconflow/deepseek-ai/DeepSeek-V3.2" });
			const credentials = JSON.parse(await readFile(process.env.YONDER_T08_AUTH_SOURCE!, "utf8"));
			if (credentials.siliconflow?.type !== "api_key" || typeof credentials.siliconflow.key !== "string")
				throw new Error("siliconflow API-key slot unavailable");
			const auth = join(home, "acceptance-auth.json");
			await writeFile(auth, JSON.stringify({ siliconflow: credentials.siliconflow }), { mode: 0o600 });
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
			agent.profiles.owner.tools = { offer: ["task_run", "task_control"], search: [] };
			await writeFile(agentPath, stringify(agent));
			await writeFile(
				join(home, "presets/t08-child.yaml"),
				stringify({
					schema: 1,
					description: "short independent calculation",
					model: "siliconflow/deepseek-ai/DeepSeek-V3.2",
					capabilities: ["read"],
					tools: { offer: [], search: [] },
					plugins: [],
					skills: [],
				}),
			);
			kernel = await openKernel(home);
			const sent = await kernel.bots.send(
				"main",
				"Call task_run twice in parallel in the same assistant message using preset t08-child and async=true for both. Give one child the task 'Calculate 31 * 17 and reply STATUS: done with the answer' and the other 'Calculate 29 * 19 and reply STATUS: done with the answer'. Do not repeat either call. Report both child results when available.",
			);
			let children: Awaited<ReturnType<typeof kernel.sessions.list>> = [];
			await expect
				.poll(
					async () => {
						const sessions = await kernel!.sessions.list({});
						const parent = sessions.find((session) => session.agent === "main");
						children = sessions.filter((session) => session.parent === parent?.id && session.profile === "t08-child");
						const events = (await kernel!.events.query({ limit: 1000 })).events;
						return (
							children.length === 2 &&
							children.every((child) =>
								events.some(
									(event) => event.type === "run.end" && (event.data as { session?: string }).session === child.id,
								),
							)
						);
					},
					{ timeout: 180000, interval: 500 },
				)
				.toBe(true);
			const events = (await kernel.events.query({ limit: 1000 })).events;
			const ends = children.map((child) =>
				events.find((event) => event.type === "run.end" && (event.data as { session?: string }).session === child.id),
			);
			expect(ends.every((event) => (event?.data as { status?: string } | undefined)?.status === "done")).toBe(true);
			expect(Math.max(...children.map((child) => Date.parse(child.opened)))).toBeLessThan(
				Math.min(...ends.map((event) => Date.parse(event!.ts))),
			);
			const parent = (await kernel.sessions.list({})).find((session) => session.agent === "main")!;
			await expect
				.poll(
					async () =>
						(await kernel!.sessions.transcript(parent.id)).some((entry) =>
							/527[\s\S]*551|551[\s\S]*527/.test(entry.text),
						),
					{
						timeout: 60000,
						interval: 500,
					},
				)
				.toBe(true);
			const calls = (await kernel.sessions.transcript(parent.id))
				.flatMap((entry) => entry.tools ?? [])
				.filter((tool) => tool.name === "task_run");
			expect(calls).toHaveLength(2);
			expect(calls.every((call) => (call.args as { async?: boolean }).async === true)).toBe(true);
			const transcript = await kernel.sessions.transcript(parent.id);
			const handle = transcript.map((entry) => entry.text.match(/"background":"(\d+)"/)?.[1]).find(Boolean);
			expect(handle).toBeTruthy();
			await kernel.bots.send(
				"main",
				`Call task_control with action resume, id ${handle}, and message "Reply STATUS: done and RESUMED_T08". Report the actual result.`,
			);
			await expect
				.poll(
					async () =>
						(await kernel!.sessions.transcript(parent.id)).some((entry) =>
							entry.tools?.some(
								(call) => call.name === "task_control" && (call.args as { action?: string }).action === "resume",
							),
						),
					{ timeout: 60000, interval: 500 },
				)
				.toBe(true);
			await expect
				.poll(
					async () =>
						(await kernel!.events.query({ limit: 1000 })).events.filter(
							(event) =>
								event.type === "run.end" &&
								children.some((child) => (event.data as { session?: string }).session === child.id),
						).length,
					{ timeout: 60000, interval: 500 },
				)
				.toBeGreaterThan(2);
			expect(sent.event).toBeTruthy();
		} finally {
			await kernel?.close();
			await rm(home, { recursive: true, force: true });
		}
	},
	210000,
);
