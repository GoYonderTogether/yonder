import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { controlHandler, initHome, openKernel, releaseInfo, serveControl } from "@yonder/local-host";
import { testModel } from "@yonder/local-host/config/test-support";
import { tempHome } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";

const auth = process.env.YONDER_TEST_AUTH ?? resolve(".yonder/auth.json");
const catalogHome = process.env.YONDER_TEST_MODEL_CATALOG_HOME;

function safeEvidenceText(text: string): string {
	return text
		.replaceAll(auth, "[AUTH_PATH]")
		.replace(/Bearer\s+\S+/giu, "Bearer [REDACTED]")
		.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, "[REDACTED_KEY]")
		.replace(/((?:api[_-]?key|token|secret|password)\s*[:=]\s*["']?)[^\s"']+/giu, "$1[REDACTED]")
		.slice(-2_000);
}
test.skipIf(process.env.YONDER_TEST_REAL !== "1" || !existsSync(auth) || !catalogHome || !existsSync(catalogHome))(
	"real Luna handles the owner's natural request to use Sonnet privately and Terra in groups",
	async () => {
		const attempt = randomUUID();
		const attemptPath = resolve(`.cache/self-config-natural-${attempt}.json`);
		const home = await tempHome("yonder-self-config-natural-");
		let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
		let control: Awaited<ReturnType<typeof serveControl>> | undefined;
		let socket: Socket | undefined;
		const controlActions: string[] = [];
		const packets: Array<{ type: string; text?: string; event?: { id: string } }> = [];
		let inputId: string | undefined;
		let run: Record<string, unknown> | undefined;
		try {
			if (!catalogHome) throw new Error("No model catalog home was supplied");
			// Copy only configured provider/model metadata; credentials remain for the trusted runtime to read.
			const sourceConfig = parse(await readFile(resolve(catalogHome, "yonder.yaml"), "utf8")) as {
				models?: {
					providers?: Record<
						string,
						{
							baseUrl?: string;
							api?: string;
							authHeader?: boolean;
							compat?: Record<string, unknown>;
							models?: Array<Record<string, unknown>>;
						}
					>;
				};
			};
			const rightapi = sourceConfig.models?.providers?.rightapi;
			const sonnet = rightapi?.models?.find((model) => model.id === "claude-sonnet-5-5");
			const openai = sourceConfig.models?.providers?.openai;
			const terra = openai?.models?.find((model) => model.id === "gpt-6.1-terra");
			if (!rightapi?.baseUrl || !rightapi.api || !sonnet)
				throw new Error("Configured Sonnet 5.5 catalog entry is unavailable");
			if (!terra) throw new Error("Configured Terra catalog entry is unavailable");
			const modelMetadata = (model: Record<string, unknown>) =>
				Object.fromEntries(
					["id", "name", "reasoning", "input", "contextWindow", "maxTokens", "compat"].flatMap((key) =>
						key in model ? [[key, model[key]]] : [],
					),
				);
			const sonnetMetadata = modelMetadata(sonnet);
			const terraMetadata = modelMetadata(terra);
			await initHome(home, "owner", { model: testModel });
			const configPath = resolve(home, "yonder.yaml");
			const config = parse(await readFile(configPath, "utf8"));
			config.credentials = auth;
			config.models = {
				providers: {
					openai: { models: [terraMetadata] },
					rightapi: {
						baseUrl: rightapi.baseUrl,
						api: rightapi.api,
						...(rightapi.authHeader === undefined ? {} : { authHeader: rightapi.authHeader }),
						...(rightapi.compat ? { compat: rightapi.compat } : {}),
						models: [sonnetMetadata],
					},
				},
			};
			await writeFile(configPath, stringify(config));
			const agentPath = resolve(home, "agents/main/agent.yaml");
			type AgentFile = {
				defaultProfile: string;
				bindings: Array<{ match?: { kind?: string }; profile?: string }>;
				profiles: Record<string, Record<string, unknown>>;
				defaults?: unknown;
			};
			const agent = parse(await readFile(agentPath, "utf8")) as AgentFile;
			const groupProfiles = [
				...new Set(
					agent.bindings
						.filter((binding) => binding.match?.kind === "group")
						.map((binding) => binding.profile ?? agent.defaultProfile),
				),
			];
			if (!groupProfiles.length) throw new Error("The initialized home has no configured group binding to protect");
			for (const profile of groupProfiles) {
				if (!agent.profiles[profile]) throw new Error(`The configured group profile ${profile} is missing`);
				agent.profiles[profile].model = "openai/gpt-6.1-terra";
			}
			const ownerBefore = structuredClone(agent.profiles.owner);
			const groupsBefore = Object.fromEntries(
				groupProfiles.map((profile) => [profile, structuredClone(agent.profiles[profile])]),
			);
			const defaultsBefore = structuredClone(agent.defaults);
			const bindingsBefore = structuredClone(agent.bindings);
			await writeFile(agentPath, stringify(agent));
			kernel = await openKernel(home);
			const running = kernel;
			control = await serveControl(home, (request, connection) => {
				if (request.method === "management") {
					const action = (request.params as { action?: string } | undefined)?.action;
					if (action) controlActions.push(action);
				}
				return controlHandler({
					kernel: running,
					home,
					releaseInfo: () => releaseInfo(home),
					awakeStatus: () => ({}),
					stop: () => {},
				})(request, connection);
			});
			socket = createConnection(resolve(home, ".yonder/plugins/channel-cli/cli.sock"));
			createInterface({ input: socket }).on("line", (line) => packets.push(JSON.parse(line)));
			await new Promise<void>((resolveConnect, reject) => {
				socket?.once("connect", resolveConnect);
				socket?.once("error", reject);
			});
			socket.write(
				`\u001e${JSON.stringify({
					type: "input",
					text: "你把自己的私聊主模型切换成 sonnet 5.5，群聊默认还是 terra 就行了，我们私聊用 sonnet",
				})}\n`,
			);
			await expect.poll(() => packets.find((packet) => packet.type === "accepted"), { timeout: 10_000 }).toBeTruthy();
			inputId = packets.find((packet) => packet.type === "accepted")?.event?.id;
			if (!inputId) throw new Error("Local private conversation did not acknowledge the owner message");
			const acceptedInputId = inputId;
			await expect
				.poll(
					async () =>
						(await running.events.query({ type: "run.end" })).events.find(
							(event) =>
								event.parent === acceptedInputId ||
								(event.data as { inputs?: string[] }).inputs?.includes(acceptedInputId),
						),
					{ timeout: 180_000, interval: 500 },
				)
				.toBeTruthy();
			const completed = (await running.events.query({ type: "run.end" })).events.find(
				(event) =>
					event.parent === acceptedInputId || (event.data as { inputs?: string[] }).inputs?.includes(acceptedInputId),
			);
			if (!completed) throw new Error("Natural model run ended without a matching run.end event");
			run = completed.data as Record<string, unknown>;
			const disk = parse(await readFile(agentPath, "utf8")) as AgentFile;
			const effective = (await running.management({ action: "agents.show", id: "main" })) as AgentFile;
			const reloads = (await running.events.query({ type: "config.reload", after: acceptedInputId })).events;
			const outputs = (await running.events.query({ type: "message.out", after: inputId })).events;
			const evidence = {
				attempt,
				inputId,
				run: { status: run.status, model: run.model, inputs: run.inputs },
				controlActions,
				ownerModel: disk.profiles.owner?.model,
				effectiveOwnerModel: effective.profiles.owner?.model,
				groupModels: Object.fromEntries(groupProfiles.map((profile) => [profile, disk.profiles[profile]?.model])),
				ownerCapabilitiesUnchanged:
					JSON.stringify(disk.profiles.owner) ===
					JSON.stringify({ ...ownerBefore, model: "rightapi/claude-sonnet-5-5" }),
				groupProfilesUnchanged: groupProfiles.every(
					(profile) => JSON.stringify(disk.profiles[profile]) === JSON.stringify(groupsBefore[profile]),
				),
				defaultsUnchanged: JSON.stringify(disk.defaults) === JSON.stringify(defaultsBefore),
				bindingsUnchanged: JSON.stringify(disk.bindings) === JSON.stringify(bindingsBefore),
				reloads: reloads.map((event) => event.data),
				delivery: outputs.map((event) => ({
					to: (event.data as { to?: string }).to,
					delivery: (event.data as { delivery?: unknown }).delivery,
				})),
			};
			await mkdir(dirname(attemptPath), { recursive: true });
			await writeFile(attemptPath, JSON.stringify(evidence, null, 2), { mode: 0o600, flag: "wx" });
			expect(run).toMatchObject({ status: "done", model: testModel });
			expect(run.inputs).toContain(inputId);
			expect(disk.profiles.owner?.model).toBe("rightapi/claude-sonnet-5-5");
			expect(effective.profiles.owner?.model).toBe("rightapi/claude-sonnet-5-5");
			for (const profile of groupProfiles) {
				expect(disk.profiles[profile]?.model).toBe("openai/gpt-6.1-terra");
				expect(effective.profiles[profile]?.model).toBe("openai/gpt-6.1-terra");
			}
			expect(evidence.ownerCapabilitiesUnchanged).toBe(true);
			expect(evidence.groupProfilesUnchanged).toBe(true);
			expect(evidence.defaultsUnchanged).toBe(true);
			expect(evidence.bindingsUnchanged).toBe(true);
			expect(reloads.some((event) => (event.data as { ok?: boolean }).ok === true)).toBe(true);
			expect(outputs.some((event) => (event.data as { delivery?: { ok?: boolean } }).delivery?.ok)).toBe(true);
		} catch (error) {
			await mkdir(dirname(attemptPath), { recursive: true });
			await writeFile(
				attemptPath.replace(/\.json$/u, ".failure.json"),
				JSON.stringify({ attempt, inputId, run, controlActions, error: safeEvidenceText(String(error)) }, null, 2),
				{ mode: 0o600, flag: "wx" },
			);
			throw error;
		} finally {
			socket?.destroy();
			await control?.close();
			await kernel?.close();
			await rm(home, { recursive: true, force: true });
		}
	},
	300_000,
);
