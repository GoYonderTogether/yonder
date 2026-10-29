import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initHome, requestControl } from "@yonder/core";
import { localIpcPath } from "@yonder/sdk";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";

test("CLI runs through the installed current symlink", async () => {
	const directory = await mkdtemp(join(tmpdir(), "yonder-entry-"));
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

test("chat preserves JSONL final after progress and exits when the server disconnects", async () => {
	const home = await mkdtemp(join(tmpdir(), "ychat-"));
	const directory = join(home, ".yonder/plugins/channel-cli");
	await mkdir(directory, { recursive: true });
	const server = createServer((socket) =>
		socket.end(
			`${JSON.stringify({ type: "text", delta: "Working" })}\n${JSON.stringify({ type: "final", text: "Finished" })}\n`,
		),
	);
	try {
		await new Promise<void>((done) => server.listen(localIpcPath(join(directory, "cli.sock")), done));
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
	const root = await mkdtemp(join(tmpdir(), "yonder-global-home-"));
	try {
		const env: NodeJS.ProcessEnv = { ...process.env, HOME: root, USERPROFILE: root };
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

test("CLI start readies legacy desktop UI without changing Agent tools or an explicit desktop opt-out", async () => {
	for (const disabled of [false, true]) {
		const home = await mkdtemp(join(tmpdir(), "yonder-ui-default-"));
		await initHome(home);
		const file = join(home, "yonder.yaml");
		const config = parse(await readFile(file, "utf8"));
		config.plugins = config.plugins.filter((entry: { use: string }) => entry.use !== "@yonder/plugin-ui-companion");
		if (disabled) config.plugins.push({ use: "@yonder/plugin-ui-companion", config: { desktop: false } });
		await writeFile(file, stringify(config));
		const agent = await readFile(join(home, "agents/main/agent.yaml"), "utf8");
		const cli = resolve("packages/cli/dist/index.js");
		const child = spawn(process.execPath, [cli, "start", "--home", home, "--json"], { stdio: "ignore" });
		const exited = once(child, "exit");
		try {
			await expect
				.poll(
					async () =>
						await requestControl(home, { method: "service.info" }).then(
							() => true,
							() => false,
						),
					{
						timeout: 10000,
					},
				)
				.toBe(true);
			const updated = parse(await readFile(file, "utf8"));
			expect(updated.plugins.filter((entry: { use: string }) => entry.use === "@yonder/plugin-ui-companion")).toEqual([
				disabled
					? { use: "@yonder/plugin-ui-companion", config: { desktop: false } }
					: { use: "@yonder/plugin-ui-companion" },
			]);
			expect(await readFile(join(home, "agents/main/agent.yaml"), "utf8")).toBe(agent);
			const descriptor = join(home, ".yonder/plugins/ui-companion/desktop.json");
			if (disabled) await expect(readFile(descriptor, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
			else {
				const endpoint = JSON.parse(await readFile(descriptor, "utf8"));
				expect((await fetch(endpoint.url)).status).toBe(200);
			}
		} finally {
			child.kill("SIGTERM");
			await exited;
			await rm(home, { recursive: true, force: true });
		}
	}
}, 20000);
