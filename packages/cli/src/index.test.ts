import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { stringify } from "yaml";

test("CLI runs through the installed current symlink", async () => {
	const directory = await mkdtemp("/tmp/yonder-entry-");
	try {
		const entry = join(directory, "current");
		await symlink(resolve("packages/cli/dist/index.js"), entry);
		const result = JSON.parse(execFileSync(process.execPath, [entry, "version", "--json"], { encoding: "utf8" }));
		expect(result.version).toBeTruthy();
		expect(result.source).toBe(resolve("."));
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("real CLI doctor accepts an enabled progress observer with both exact allowlists", async () => {
	const home = await mkdtemp("/tmp/yonder-progress-doctor-");
	const workspace = join(home, "agents/main");
	await mkdir(workspace, { recursive: true });
	try {
		const plugin = resolve("plugins/progress-observer");
		await writeFile(
			join(home, "yonder.yaml"),
			stringify({
				schema: 1,
				plugins: [
					{
						use: plugin,
						config: {
							enabled: true,
							allowedAgents: ["agent:main"],
							allowedSourceConversations: ["conv:test:owner-private"],
						},
					},
				],
				envs: { local: { type: "local" } },
				agents: [{ id: "main", workspace: "./agents/main" }],
			}),
		);
		await writeFile(
			join(workspace, "agent.yaml"),
			stringify({
				schema: 1,
				id: "main",
				name: "main",
				owner: "person:owner",
				defaultProfile: "owner",
				defaults: { model: "openai/gpt-6-luna", plugins: ["progress-observer"], tools: { offer: ["*"] } },
				profiles: {
					owner: {
						level: "bypass",
						model: "openai/gpt-6-luna",
						plugins: ["progress-observer"],
						tools: { offer: ["*"] },
					},
				},
				bindings: [],
			}),
		);
		const output = execFileSync(process.execPath, [resolve("packages/cli/dist/index.js"), "doctor", "--home", home], {
			cwd: resolve("."),
			encoding: "utf8",
		});
		expect(output).toContain("Doctor: passed");
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test("real CLI doctor validates the optional disabled decision-routing manifest", async () => {
	const home = await mkdtemp("/tmp/yonder-decision-doctor-");
	const workspace = join(home, "agents/main");
	await mkdir(workspace, { recursive: true });
	try {
		await writeFile(
			join(home, "yonder.yaml"),
			stringify({
				schema: 1,
				plugins: [{ use: resolve("plugins/decision-routing") }],
				envs: { local: { type: "local" } },
				agents: [{ id: "main", workspace: "./agents/main" }],
			}),
		);
		await writeFile(
			join(workspace, "agent.yaml"),
			stringify({
				schema: 1,
				id: "main",
				name: "main",
				owner: "person:owner",
				defaultProfile: "owner",
				defaults: { model: "openai/gpt-6-luna", plugins: ["decision-routing"], tools: { offer: ["*"] } },
				profiles: {
					owner: {
						level: "bypass",
						model: "openai/gpt-6-luna",
						plugins: ["decision-routing"],
						tools: { offer: ["*"] },
					},
				},
				bindings: [],
			}),
		);
		const output = execFileSync(process.execPath, [resolve("packages/cli/dist/index.js"), "doctor", "--home", home], {
			cwd: resolve("."),
			encoding: "utf8",
		});
		expect(output).toContain("Doctor: passed");
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test("chat preserves JSONL final after progress and exits when the server disconnects", async () => {
	const home = await mkdtemp("/tmp/ychat-");
	const directory = join(home, ".yonder/plugins/channel-cli");
	await mkdir(directory, { recursive: true });
	const server = createServer((socket) =>
		socket.end(
			`${JSON.stringify({ type: "text", delta: "Working" })}\n${JSON.stringify({ type: "final", text: "Finished" })}\n`,
		),
	);
	try {
		await new Promise<void>((done) => server.listen(join(directory, "cli.sock"), done));
		const child = spawn(process.execPath, [
			resolve("packages/cli/dist/index.js"),
			"chat",
			"--channel",
			"cli",
			"--home",
			home,
			"--json",
		]);
		let out = "",
			err = "";
		child.stdout.on("data", (chunk) => {
			out += chunk;
		});
		child.stderr.on("data", (chunk) => {
			err += chunk;
		});
		const code = await new Promise<number | null>((done) => child.once("exit", done));
		expect(code, err).toBe(0);
		expect(
			out
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line)),
		).toEqual([
			{ type: "text", delta: "Working" },
			{ type: "final", text: "Finished" },
		]);
	} finally {
		await new Promise<void>((done) => server.close(() => done()));
		await rm(home, { recursive: true, force: true });
	}
});

test("global CLI discovers the default user home and preserves explicit overrides", async () => {
	const root = await mkdtemp("/tmp/yonder-global-home-");
	try {
		const env: NodeJS.ProcessEnv = { ...process.env, HOME: root };
		delete env.YONDER_HOME;
		const version = (args: string[], extra = {}) =>
			JSON.parse(
				execFileSync(process.execPath, [resolve("packages/cli/dist/index.js"), "version", ...args, "--json"], {
					cwd: root,
					env: { ...env, ...extra },
					encoding: "utf8",
				}),
			);
		expect(version([]).home).toBe(join(root, ".local/share/yonder-harness/home"));
		expect(version([], { YONDER_HOME: join(root, "dev") }).home).toBe(join(root, "dev"));
		expect(version(["--home", join(root, "explicit")], { YONDER_HOME: join(root, "dev") }).home).toBe(
			join(root, "explicit"),
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
