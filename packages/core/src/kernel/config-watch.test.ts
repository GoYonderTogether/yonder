import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tempHome } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { ConfigError, loadYonderConfig } from "../config/index.js";
import { resolveProfile } from "../config/test-support.js";
import type { LoadedPlugins } from "../plugins/index.js";
import { localEnvironment } from "../runtime/env.js";
import { configRuntimeSections, runtimeConfigFact } from "./config-facts.js";
import { watchAgents } from "./config-watch.js";
import { initHome } from "./home.js";
import { loadAgents } from "./workspace.js";

function plugins(envs = new Map()) {
	return {
		channels: new Map(),
		tools: new Map(),
		envs,
	} as unknown as LoadedPlugins;
}

test("kernel section callback resolves the current watcher for every request", async () => {
	let current:
		| {
				status(agentId?: string): Promise<{
					home: { state: "effective" | "pending"; revision: string; file: string };
					candidate: { state: "effective" | "pending"; revision: string };
				}>;
		  }
		| undefined;
	const options: Parameters<typeof configRuntimeSections>[1] = {
		contexts: new Map(),
		workspace: () => {
			throw new Error("No workspace should be needed for an empty prompt");
		},
	};
	const wired = configRuntimeSections(() => current, options, new Map());
	const session = {
		id: "session:config-facts",
		agent: "main",
		profile: "owner",
		cwd: "/tmp",
		resolved: resolveProfile({ model: "openai/gpt-6-luna", prompt: { sections: [] } }),
	};
	const render = async () =>
		(await wired.sections(session)).find((part) => part.key === "runtime-config-acceptance")?.text;
	expect(await render()).toContain('"state":"unknown"');
	current = {
		status: async () => ({
			home: { state: "effective", revision: "accepted-1", file: "yonder.yaml" },
			candidate: { state: "effective", revision: "accepted-1" },
		}),
	};
	expect(await render()).toContain('"revision":"accepted-1"');
	current = {
		status: async () => ({
			home: { state: "pending", revision: "pending-2", file: "yonder.yaml" },
			candidate: { state: "pending", revision: "pending-2" },
		}),
	};
	expect(await render()).toContain('"revision":"pending-2"');
});

async function watcherFor(home: string, loaded: LoadedPlugins) {
	const config = await loadYonderConfig(home);
	const agents = await loadAgents(home, config, loaded);
	let rejectCandidate = false;
	const watcher = await watchAgents({
		home,
		config,
		agents,
		presets: new Map(),
		loaded,
		store: { events: { record: async () => {} } } as never,
		log: () => {},
		validateCandidate: async () => {
			if (rejectCandidate)
				throw new ConfigError([{ file: "agent.yaml", path: "/name", message: "candidate validation rejected" }]);
		},
		scaffoldAgent: async () => {},
	});
	return { config, agents, watcher, rejectCandidate: (value: boolean) => (rejectCandidate = value) };
}

test("runtime config facts distinguish rejected edits, accepted revisions, and restart-required home changes", async () => {
	const home = await tempHome("yonder-config-facts-");
	try {
		await initHome(home, "owner", { model: "openai/gpt-6-luna" });
		const loaded = plugins();
		const { agents, watcher, rejectCandidate } = await watcherFor(home, loaded);
		try {
			await watcher.reload();
			const initial = await watcher.status("main");
			expect(initial.home.state).toBe("effective");
			expect(initial.agent?.state).toBe("effective");
			expect(initial.agent?.acceptedRevision).toBe(initial.agent?.revision);

			const agentFile = join(home, "agents/main/agent.yaml");
			const original = await readFile(agentFile, "utf8");
			let activeName = agents.get("main")?.name;
			await writeFile(agentFile, original.replace(/^name:.*$/mu, "name: Rejected valid candidate"));
			rejectCandidate(true);
			await expect(watcher.reload()).rejects.toThrow("candidate validation rejected");
			const rejectedCandidate = await watcher.status("main");
			expect(rejectedCandidate.agent?.state).toBe("pending");
			expect(rejectedCandidate.candidate.state).toBe("rejected");
			expect(rejectedCandidate.candidate.acceptedRevision).not.toBe(rejectedCandidate.candidate.revision);
			expect(rejectedCandidate.issues).toContainEqual({ scope: "candidate" });
			expect(agents.get("main")?.name).toBe(activeName);
			await writeFile(agentFile, original.replace(/^name:.*$/mu, "name: Corrected after reject"));
			expect((await watcher.status("main")).candidate.state).toBe("pending");
			rejectCandidate(false);
			await watcher.reload();
			expect((await watcher.status("main")).candidate.state).toBe("effective");
			activeName = agents.get("main")?.name;

			await writeFile(agentFile, `${original}\nname: TOP_SECRET_INVALID_DUPLICATE\n`);
			// A successful file write alone is not a runtime acceptance receipt.
			const written = await watcher.status("main");
			expect(written.agent?.state).toBe("pending");
			await expect(watcher.reload()).rejects.toThrow();
			const rejected = await watcher.status("main");
			expect(rejected.agent?.state).toBe("rejected");
			expect(rejected.candidate.state).toBe("rejected");
			expect(rejected.agent?.acceptedRevision).not.toBe(rejected.agent?.revision);
			expect(rejected.issues).toContainEqual({ scope: "agent", path: "/" });
			const rejectedFact = await runtimeConfigFact(watcher, "main");
			expect(rejectedFact.text).toContain('"scope":"agent","path":"/"');
			expect(rejectedFact.text).toContain("authorized native management path");
			expect(agents.get("main")?.name).toBe(activeName);
			expect(JSON.stringify(rejected)).not.toContain("TOP_SECRET_INVALID_DUPLICATE");
			expect(rejectedFact.text).not.toContain("TOP_SECRET_INVALID_DUPLICATE");

			const corrected = original.replace(/^name:.*$/mu, "name: Corrected fact test");
			await writeFile(agentFile, corrected);
			const correctedPending = await watcher.status("main");
			expect(correctedPending.agent?.state).toBe("pending");
			expect(correctedPending.issues).toBeUndefined();
			expect((await runtimeConfigFact(watcher, "main")).text).not.toContain('"scope":"agent"');
			await watcher.reload();
			const correctedAccepted = await watcher.status("main");
			expect(correctedAccepted.agent?.state).toBe("effective");
			expect(correctedAccepted.issues).toBeUndefined();
			expect(agents.get("main")?.name).toBe("Corrected fact test");

			const rootFile = join(home, "yonder.yaml");
			const root = await readFile(rootFile, "utf8");
			await writeFile(rootFile, root.replace("timezone: Asia/Shanghai", "timezone: UTC"));
			expect((await watcher.status("main")).home.state).toBe("pending-restart");
			await watcher.reload();
			const restartRequired = await watcher.status("main");
			expect(restartRequired.home.state).toBe("pending-restart");
			expect(restartRequired.candidate.state).toBe("pending-restart");
		} finally {
			watcher.close();
		}
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test("runtime config facts read remote Agent files through its configured workspace environment", async () => {
	const home = await tempHome("yonder-config-facts-remote-");
	const remote = await tempHome("yonder-config-facts-env-");
	try {
		await initHome(home, "owner", { model: "openai/gpt-6-luna" });
		const rootFile = join(home, "yonder.yaml");
		const root = await readFile(rootFile, "utf8");
		const remoteWorkspace = join(remote, "agent-main");
		await writeFile(
			rootFile,
			root
				.replace("workspace: ./agents/main", `workspace: ${remoteWorkspace}\n    env: remote`)
				.replace("envs:\n  local:", "envs:\n  remote: { type: local }\n  local:"),
		);
		await mkdir(remoteWorkspace, { recursive: true });
		await writeFile(join(remoteWorkspace, "agent.yaml"), await readFile(join(home, "agents/main/agent.yaml"), "utf8"));
		const loaded = plugins(new Map([["remote", localEnvironment(remote)]]));
		const { watcher } = await watcherFor(home, loaded);
		try {
			await watcher.reload();
			expect((await watcher.status("main")).agent?.state).toBe("effective");
			await writeFile(join(remoteWorkspace, "agent.yaml"), "schema: [SECRET_PARSE_FAILURE\n");
			await expect(watcher.reload()).rejects.toThrow();
			const status = await watcher.status("main");
			expect(status.agent?.state).toBe("rejected");
			expect(status.candidate.state).toBe("rejected");
			expect(status.issues).toContainEqual({ scope: "agent", path: "/" });
			expect(JSON.stringify(status)).not.toContain("SECRET_PARSE_FAILURE");
		} finally {
			watcher.close();
		}
	} finally {
		await Promise.all([rm(home, { recursive: true, force: true }), rm(remote, { recursive: true, force: true })]);
	}
});
