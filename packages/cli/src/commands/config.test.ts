import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stderr, stdout } from "node:process";
import { initHome } from "@yonder/core";
import { tempHome } from "@yonder/sdk/testing";
import { afterEach, expect, test, vi } from "vitest";
import { parse, stringify } from "yaml";
import { testModel } from "../../../core/src/config/test-support.js";
import { runConfig } from "./config.js";
import * as context from "./context.js";

const contextEnv = "YONDER_RUNTIME_INSPECT_CONTEXT";
afterEach(() => vi.unstubAllEnvs());

async function configuredHome() {
	const home = await tempHome("ya-inspect-");
	await initHome(home, "owner", { model: testModel });
	const file = join(home, "agents/main/agent.yaml");
	const main = parse(await readFile(file, "utf8"));
	const profile = structuredClone(Object.values(main.profiles)[0]);
	main.profiles.private = structuredClone(profile);
	main.profiles.group = structuredClone(profile);
	main.defaultProfile = "group";
	await writeFile(file, stringify(main));
	const otherDir = join(home, "agents/other");
	await mkdir(otherDir, { recursive: true });
	const other = structuredClone(main);
	other.id = "other";
	await writeFile(join(otherDir, "agent.yaml"), stringify(other));
	const configFile = join(home, "yonder.yaml");
	const config = parse(await readFile(configFile, "utf8"));
	config.agents.push({ id: "other", workspace: "./agents/other" });
	await writeFile(configFile, stringify(config));
	return home;
}

async function inspect(home: string, args: string[], contextHome?: string) {
	let output = "";
	const write = vi.spyOn(stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
		output += String(chunk);
		return true;
	}) as typeof stdout.write);
	if (contextHome) vi.stubEnv(contextEnv, JSON.stringify({ home: contextHome, agent: "main", profile: "private" }));
	else vi.stubEnv(contextEnv, undefined);
	try {
		await runConfig("inspect", { home, json: true, help: false, rest: [] }, args);
		return JSON.parse(output) as Record<string, unknown>;
	} finally {
		write.mockRestore();
	}
}

test("inspect uses matching runtime context only for unspecified compatible targets", async () => {
	const home = await configuredHome();
	const otherHome = await configuredHome();
	try {
		const current = await inspect(home, [], home);
		expect(current).toMatchObject({
			agent: "main",
			profile: "private",
			inspectionContext: {
				source: "current runtime session",
				agent: "current runtime session",
				profile: "current runtime session",
			},
		});

		const explicitProfile = await inspect(home, ["--profile", "group"], home);
		expect(explicitProfile).toMatchObject({ agent: "main", profile: "group" });
		expect(explicitProfile.inspectionContext).toMatchObject({
			agent: "current runtime session",
			profile: "explicit",
		});

		const otherAgent = await inspect(home, ["--agent", "other"], home);
		expect(otherAgent).toMatchObject({ agent: "other", profile: "group" });
		expect(otherAgent).not.toHaveProperty("inspectionContext");

		const crossHome = await inspect(otherHome, [], home);
		expect(crossHome).toMatchObject({ agent: "main", profile: "group" });
		expect(crossHome).not.toHaveProperty("inspectionContext");

		const terminal = await inspect(home, []);
		expect(terminal).toMatchObject({ agent: "main", profile: "group" });
		expect(terminal).not.toHaveProperty("inspectionContext");

		const selected = await inspect(home, ["--conv", "conv:feishu:group", "--event", "inbound-1"], home);
		expect(selected.operability).toMatchObject({
			status: "unknown",
			selector: { conv: "conv:feishu:group", eventId: "inbound-1" },
		});
	} finally {
		await Promise.all([rm(home, { recursive: true, force: true }), rm(otherHome, { recursive: true, force: true })]);
	}
});

test("agents show keeps raw JSON stdout and reports unavailable runtime facts separately", async () => {
	const home = await configuredHome();
	const otherHome = await configuredHome();
	let stdoutText = "";
	let stderrText = "";
	const out = vi.spyOn(stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
		stdoutText += String(chunk);
		return true;
	}) as typeof stdout.write);
	const err = vi.spyOn(stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
		stderrText += String(chunk);
		return true;
	}) as typeof stderr.write);
	vi.stubEnv(contextEnv, JSON.stringify({ home, agent: "main", profile: "private" }));
	try {
		await runConfig("agents", { home, json: true, help: false, rest: [] }, ["show", "main"]);
		const shown = JSON.parse(stdoutText) as Record<string, unknown>;
		expect(shown).toMatchObject({ id: "main", workspace: expect.any(String), env: "local" });
		expect(shown).not.toHaveProperty("operability");
		expect(stderrText).toContain("Session operability: unknown");
		stdoutText = "";
		stderrText = "";
		vi.stubEnv(contextEnv, JSON.stringify({ home: otherHome, agent: "main", profile: "private" }));
		await runConfig("agents", { home, json: true, help: false, rest: [] }, ["show", "main"]);
		expect(JSON.parse(stdoutText)).toMatchObject({ id: "main", workspace: expect.any(String), env: "local" });
		expect(stderrText).toBe("");
	} finally {
		out.mockRestore();
		err.mockRestore();
		await Promise.all([rm(home, { recursive: true, force: true }), rm(otherHome, { recursive: true, force: true })]);
	}
});

test("agents show summarizes scope and bot source facts without changing config JSON", async () => {
	const home = await configuredHome();
	let stdoutText = "";
	let stderrText = "";
	const out = vi.spyOn(stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
		stdoutText += String(chunk);
		return true;
	}) as typeof stdout.write);
	const err = vi.spyOn(stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
		stderrText += String(chunk);
		return true;
	}) as typeof stderr.write);
	const config = { id: "main", profiles: { private: {} }, bindings: [] };
	const inspection = {
		runtimeLoaded: [],
		operability: {
			status: "observed",
			limit: 8,
			truncated: false,
			conversations: [
				{
					status: "observed",
					sample: {
						eventId: "p1-event",
						conv: "conv:feishu:group:p1",
						kind: "group",
						from: "acct:feishu:owner",
						relation: "owner",
					},
					history: { execution: { state: "not-observed" }, delivery: { state: "not-observed" } },
					prediction: {
						state: "matched",
						binding: "p1-source",
						wake: "write",
						participationScope: { includesConversation: false },
						consumer: { state: "not-applicable", reason: "outside-social-scope" },
					},
				},
				{
					status: "observed",
					sample: {
						eventId: "echo-event",
						conv: "conv:qq:group:jarvis",
						from: "acct:qq:jarvis",
						relation: "stranger",
						senderIsBot: true,
						nativeKind: "GROUP_MESSAGE_CREATE",
					},
					history: { execution: { state: "not-observed" }, delivery: { state: "not-observed" } },
					prediction: {
						state: "matched",
						route: "dropped",
						dropReason: "no-binding",
						participation: { reason: "record", run: false },
						participationScope: { includesConversation: true },
					},
				},
			],
		},
	};
	const managed = vi
		.spyOn(context, "managed")
		.mockResolvedValueOnce(config as never)
		.mockResolvedValueOnce(inspection as never);
	vi.stubEnv(contextEnv, JSON.stringify({ home, agent: "main", profile: "private" }));
	try {
		await runConfig("agents", { home, json: true, help: false, rest: [] }, ["show", "main"]);
		expect(JSON.parse(stdoutText)).toEqual(config);
		expect(JSON.parse(stdoutText)).not.toHaveProperty("operability");
		expect(stderrText).toContain(
			"record-only: wake=write; social consumer not applicable because scope excludes this conversation",
		);
		expect(stderrText).toContain("consumer");
		expect(stderrText).toContain("senderIsBot=true");
		expect(stderrText).toContain("nativeKind");
		expect(stderrText).toContain("participation reason=record");
		expect(stderrText).toContain("relation");
		expect(stderrText).not.toContain("bot sender caused");
	} finally {
		managed.mockRestore();
		out.mockRestore();
		err.mockRestore();
		await rm(home, { recursive: true, force: true });
	}
});
