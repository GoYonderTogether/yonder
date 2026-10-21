import { mkdtemp, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { resolveProfile } from "../config/index.js";
import { openDatabase } from "./db.js";
import {
	credentialPath,
	FileCredentials,
	localEnvironment,
	Runtime,
	submissionOutcome,
	workspaceFiles,
} from "./index.js";
import { buildModels } from "./models.js";

test("submission outcomes preserve native failures and prioritize Yonder limits", () => {
	const native = (value: object) => value as Parameters<typeof submissionOutcome>[0];
	expect(submissionOutcome(native({ status: "done", entry: 1, answer: 2 }))).toEqual({ status: "done" });
	expect(submissionOutcome(native({ status: "unanswered", reason: "aborted" }))).toEqual({
		status: "aborted",
		reason: "aborted",
	});
	expect(submissionOutcome(native({ status: "unanswered", reason: "model_error", detail: "provider failed" }))).toEqual(
		{
			status: "error",
			reason: "model_error: provider failed",
		},
	);
	expect(submissionOutcome(native({ status: "unanswered", reason: "faulted" }))).toEqual({
		status: "error",
		reason: "faulted",
	});
	expect(submissionOutcome(native({ status: "unanswered", reason: "model_error" }), "maxTurns")).toEqual({
		status: "limit",
		reason: "maxTurns",
	});
	expect(submissionOutcome(native({ status: "done", entry: 1, answer: 2 }), "maxMinutes")).toEqual({
		status: "limit",
		reason: "maxMinutes",
	});
});

test("real SQLite conversation lifecycle, workspace IO, credential lock and provider overlays", async () => {
	expect(credentialPath("/tmp/home", "~/.yonder-credentials/auth.json")).toBe(
		join(homedir(), ".yonder-credentials/auth.json"),
	);
	expect(credentialPath("/tmp/home")).toBe("/tmp/home/.yonder/auth.json");
	const home = await mkdtemp(join(tmpdir(), "yonder-runtime-"));
	let runtime: Runtime | undefined;
	try {
		const files = workspaceFiles(localEnvironment(home));
		await files.writeFile("AGENTS.md", "Runtime integration verification");
		expect(await files.readFile("AGENTS.md")).toBe("Runtime integration verification");
		const credentials = new FileCredentials(join(home, ".yonder/auth.json"));
		await Promise.all([credentials.modify("openai", async (current) => current), credentials.list()]);
		expect(await credentials.get("openai")).toBeUndefined();
		expect((await stat(join(home, ".yonder/auth.json"))).mode & 0o777).toBe(0o600);
		const models = buildModels(credentials, {
			openai: { modelOverrides: { "gpt-6-luna": { contextWindow: 64000 } } },
			deepseek: {
				api: "openai-completions",
				baseUrl: "https://api.deepseek.com/v1",
				models: [{ id: "deepseek-chat" }],
			},
		});
		expect(models.getProvider("openai")?.auth.oauth).toBeDefined();
		expect(models.getModel("openai", "gpt-6-luna")?.contextWindow).toBe(64000);
		expect(models.getModel("deepseek", "deepseek-chat")?.maxTokens).toBe(16384);
		const options = {
			home,
			config: { schema: 1 as const },
			resolveSession: async () => ({
				agent: null,
				profile: "default",
				cwd: home,
				resolved: resolveProfile({ level: "readonly" }),
			}),
		};
		runtime = await Runtime.open({ ...options, db: await openDatabase(join(home, "state.db")) });
		const id = await runtime.create({ agent: null, profile: "default", cwd: home });
		await runtime.setSessionState(id, {
			agent: null,
			profile: "default",
			cwd: home,
			env: "local",
			capabilities: ["read"],
		});
		const result = await runtime.submit(id, { text: "Runtime integration verification", wake: "write" });
		expect(result.status).toBe("done");
		expect((await runtime.transcript(id))[0]?.text).toBe("Runtime integration verification");
		expect(await runtime.usage(id)).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
		await runtime.close();
		runtime = await Runtime.open({ ...options, db: await openDatabase(join(home, "state.db")) });
		expect((await runtime.sessionState(id))?.capabilities).toEqual(["read"]);
		await runtime.configure(id);
		expect(await runtime.transcript(id)).toHaveLength(1);
	} finally {
		await runtime?.close();
		await rm(home, { recursive: true, force: true });
	}
});
