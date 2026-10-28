import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { initHome, openKernel } from "./index.js";

test.skipIf(process.env.YONDER_PT119_REAL !== "1")(
	"advisor consultation and outcome through real kernel",
	async () => {
		const home = await mkdtemp("/tmp/yonder-pt119-");
		let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
		try {
			await initHome(home, "owner", { model: "siliconflow/deepseek-ai/DeepSeek-V3.2" });
			const source = JSON.parse(await readFile(process.env.YONDER_PT119_AUTH_SOURCE!, "utf8"));
			if (source.siliconflow?.type !== "api_key" || typeof source.siliconflow.key !== "string")
				throw Error("siliconflow slot unavailable");
			const auth = join(home, "auth.json");
			await writeFile(auth, JSON.stringify({ siliconflow: source.siliconflow }), { mode: 0o600 });
			const config = parse(await readFile(join(home, "yonder.yaml"), "utf8"));
			config.credentials = auth;
			config.plugins.push({ use: resolve("plugins/advisor"), config: { outcomeLogging: true } });
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
			agent.defaults.plugins = ["advisor"];
			agent.defaults.contexts = [];
			agent.bindings = agent.bindings.filter((binding: { id: string }) => binding.id !== "onboarding");
			agent.profiles.owner.tools = { offer: ["advisor_consult", "advisor_record_advisor_outcome"], search: [] };
			await writeFile(agentPath, stringify(agent));
			await writeFile(
				join(home, "presets/consult-check.yaml"),
				stringify({
					schema: 1,
					description: "Brief independent calculation",
					model: "siliconflow/deepseek-ai/DeepSeek-V3.2",
					capabilities: ["read"],
					tools: { offer: [], search: [] },
					plugins: [],
					skills: [],
				}),
			);
			await writeFile(
				join(home, "presets/no-advisor.yaml"),
				stringify({
					schema: 1,
					description: "No plugin",
					model: "siliconflow/deepseek-ai/DeepSeek-V3.2",
					capabilities: ["read"],
					plugins: [],
					skills: [],
					tools: { offer: [], search: [] },
				}),
			);
			kernel = await openKernel(home);
			const sent = await kernel.bots.send(
				"main",
				'Call advisor_consult with preset "consult-check" and task "Calculate 7 times 8 and give the result briefly". Then call advisor_record_advisor_outcome with the returned adviceId, adoption followed and validationStatus passed. Report the actual result.',
			);
			await expect
				.poll(
					async () =>
						(await kernel!.events.query({ type: "run.end", after: sent.event })).events.some(
							(e) => e.parent === sent.event,
						),
					{ timeout: 180000, interval: 500 },
				)
				.toBe(true);
			const transcript = await kernel.sessions.transcript(sent.session!);
			const calls = transcript.flatMap((entry) => entry.tools ?? []);
			expect(calls.some((call) => call.name === "advisor_consult")).toBe(true);
			expect(calls.some((call) => call.name === "advisor_record_advisor_outcome")).toBe(true);
			expect(JSON.stringify(transcript)).toContain('recorded\\":true');
			const log = await readFile(join(home, ".yonder/plugins/advisor/outcomes.jsonl"), "utf8");
			expect(log.trim().split("\n")).toHaveLength(1);
			const session = await kernel.sessions.open({ preset: "no-advisor", close: "manual" });
			const receipt = await kernel.terminal.submit(session.id, { text: "Reply OK." });
			const running = kernel;
			await expect
				.poll(
					async () =>
						(await running.events.query({ type: "run.end", after: receipt.event })).events.some(
							(event) => event.parent === receipt.event,
						),
					{ timeout: 60000 },
				)
				.toBe(true);
			const db = new DatabaseSync(join(home, ".yonder/state.db"), { readOnly: true });
			try {
				const row = db
					.prepare(
						"SELECT r.content FROM pi_document_revisions r JOIN pi_documents d ON d.id=r.document_id WHERE json_extract(d.record,'$.kind')='pi.agent' AND d.owner_id=? ORDER BY r.seq DESC LIMIT 1",
					)
					.get(Number(session.id));
				const modelTools = JSON.parse(String(row?.content)).modelTools as string[];
				expect(modelTools).not.toContain("advisor_consult");
				expect(modelTools).not.toContain("advisor_record_advisor_outcome");
			} finally {
				db.close();
			}
			console.log(
				"PT119 live",
				JSON.stringify({ calls: calls.map((call) => call.name), outcomes: 1, unselected: true }),
			);
		} finally {
			await kernel?.close();
			await rm(home, { recursive: true, force: true });
		}
	},
	210000,
);

test("advisor truncation points to the shared output cache", async () => {
	const { createRegistrationCollector } = await import("@yonder/sdk/testing");
	const { cacheToolOutput } = await import("../runtime/tool-output-cache.js");
	const pluginPath = resolve("plugins/advisor/dist/index.js");
	const plugin = (await import(pluginPath)).default;
	const home = await mkdtemp("/tmp/yonder-pt119-cache-");
	try {
		const text = `${"x".repeat(31_000)}CACHE_END`;
		const ref = await cacheToolOutput(home, "1", "task_run", {}, text);
		const collector = createRegistrationCollector();
		await plugin.setup({
			...collector.api,
			subagents: { run: async () => ({ text: JSON.stringify({ status: "done", text, resultFile: ref }) }) },
		} as never);
		const consult = collector.registrations.tools.find((tool) => tool.name === "advisor_consult");
		if (!consult) throw Error("advisor tool missing");
		const result = await consult.execute({ preset: "test", task: "test" }, { session: "1" } as never);
		expect(result.text).toContain(ref);
		expect(result.text).not.toContain("CACHE_END");
		expect(await readFile(ref, "utf8")).toBe(text);
		expect(await readFile(join(home, "cache/tool-output/1/index.jsonl"), "utf8")).toContain('"tool":"task_run"');
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
