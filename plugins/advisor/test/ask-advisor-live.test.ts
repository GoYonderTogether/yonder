import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { initHome, openKernel } from "../../../packages/core/src/kernel/index.js";

const model = "workbuddy/deepseek-v4.1-flash";

/**
 * Real-model check for IMP-08 (O51 SA4). It runs the built plugin through the real kernel, so
 * `npx tsc -b plugins/advisor` must have produced `plugins/advisor/dist` first.
 * Credentials are read from a home that already holds the workbuddy slot; nothing is printed.
 */
test.skipIf(process.env.YONDER_ADVISOR_REAL !== "1")(
	"advisor_ask_advisor starts a consultation from an empty object and the old name still works",
	async () => {
		const home = await mkdtemp("/tmp/yonder-advisor-");
		let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
		try {
			await initHome(home, "owner", { model });
			const sourceAuth = JSON.parse(await readFile(process.env.YONDER_ADVISOR_AUTH_SOURCE!, "utf8")) as {
				workbuddy?: { type?: string; key?: string };
			};
			if (sourceAuth.workbuddy?.type !== "api_key" || typeof sourceAuth.workbuddy.key !== "string")
				throw Error("workbuddy slot unavailable");
			const sourceConfig = parse(await readFile(process.env.YONDER_ADVISOR_CONFIG_SOURCE!, "utf8")) as {
				models?: { providers?: Record<string, unknown> };
			};
			const provider = sourceConfig.models?.providers?.workbuddy;
			if (!provider) throw Error("workbuddy provider unavailable");
			const auth = join(home, "auth.json");
			await writeFile(auth, JSON.stringify({ workbuddy: sourceAuth.workbuddy }), { mode: 0o600 });
			const config = parse(await readFile(join(home, "yonder.yaml"), "utf8"));
			config.credentials = auth;
			config.models = { providers: { workbuddy: provider } };
			config.plugins.push({ use: resolve("plugins/advisor"), config: { outcomeLogging: true } });
			await writeFile(join(home, "yonder.yaml"), stringify(config));
			const agentPath = join(home, "agents/main/agent.yaml");
			const agent = parse(await readFile(agentPath, "utf8"));
			agent.defaults.plugins = ["advisor"];
			agent.defaults.contexts = [];
			agent.bindings = agent.bindings.filter((binding: { id: string }) => binding.id !== "onboarding");
			agent.profiles.owner.tools = {
				offer: ["advisor_ask_advisor", "advisor_consult", "advisor_record_advisor_outcome"],
				search: [],
			};
			await writeFile(agentPath, stringify(agent));
			// `advisor_ask_advisor` consults the `default` preset unless plugin config names another one.
			await writeFile(
				join(home, "presets/default.yaml"),
				stringify({
					schema: 1,
					description: "Brief independent answer",
					model,
					capabilities: [],
					tools: { offer: [], search: [] },
					plugins: [],
					skills: [],
				}),
			);
			kernel = await openKernel(home);
			const running = kernel;
			const settle = (event: number) =>
				expect
					.poll(
						async () =>
							(await running.events.query({ type: "run.end", after: event })).events.some(
								(row) => row.parent === event,
							),
						{ timeout: 180000, interval: 500 },
					)
					.toBe(true);

			const empty = await kernel.bots.send(
				"main",
				'Call advisor_ask_advisor exactly once with an empty object "{}" as its arguments and no parameters. Then repeat the adviceId the tool returned.',
			);
			await settle(empty.event);
			const first = (await kernel.sessions.transcript(empty.session!)).flatMap((entry) => entry.tools ?? []);
			const consulted = first.filter((call) => call.name === "advisor_ask_advisor");
			// The model may retry; the check is that an empty-object call was accepted.
			expect(consulted.some((call) => Object.keys(call.args ?? {}).length === 0)).toBe(true);

			const legacy = await kernel.bots.send(
				"main",
				'Call advisor_consult with preset "default" and task "Calculate 7 times 8 and answer briefly." Then repeat the adviceId it returned.',
			);
			await settle(legacy.event);
			const transcript = await kernel.sessions.transcript(legacy.session!);
			const second = transcript.flatMap((entry) => entry.tools ?? []).filter((call) => call.name === "advisor_consult");
			expect(second.some((call) => (call.args as { preset?: string }).preset === "default")).toBe(true);
			expect(JSON.stringify(transcript)).toContain("adviceId: ");
			console.log("IMP-08 live", JSON.stringify({ emptyObject: true, legacyName: true }));
		} finally {
			await kernel?.close();
			await rm(home, { recursive: true, force: true });
		}
	},
	300000,
);
