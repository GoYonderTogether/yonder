import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { cliChannelEndpoint, initHome, requestControl } from "@yonder/core";
import { tempHome } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { testModel } from "../../core/src/config/test-support.js";

test("CLI runs through the installed current symlink", async () => {
	const directory = await tempHome("ya-");
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
	const home = await tempHome("ya-");
	const directory = join(home, ".yonder/plugins/channel-cli");
	await mkdir(directory, { recursive: true });
	const server = createServer((socket) =>
		socket.end(
			`${JSON.stringify({ type: "text", delta: "Working" })}\n${JSON.stringify({ type: "final", text: "Finished" })}\n`,
		),
	);
	try {
		await new Promise<void>((done, reject) => {
			server.once("error", reject);
			server.listen(cliChannelEndpoint(home, "cli"), done);
		});
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
	const root = await tempHome("ya-");
	try {
		const env: NodeJS.ProcessEnv = { ...process.env, HOME: root, USERPROFILE: root, LOCALAPPDATA: root };
		delete env.YONDER_HOME;
		const version = (args: string[], extra = {}) =>
			JSON.parse(
				execFileSync(process.execPath, [resolve("packages/cli/dist/index.js"), "version", ...args, "--json"], {
					cwd: root,
					env: { ...env, ...extra },
					encoding: "utf8",
				}),
			);
		expect(version([]).home).toBe(
			join(root, process.platform === "win32" ? "YonderHarness/home" : ".local/share/yonder/home"),
		);
		expect(version([], { YONDER_HOME: join(root, "dev") }).home).toBe(join(root, "dev"));
		expect(version(["--home", join(root, "explicit")], { YONDER_HOME: join(root, "dev") }).home).toBe(
			join(root, "explicit"),
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test.each([false, true])(
	"CLI start preserves interaction configuration (desktop disabled: %s) and Agent tools without publishing a retired desktop endpoint",
	async (disabled) => {
		const home = await tempHome("ya-");
		await initHome(home, "owner", { model: testModel });
		const file = join(home, "yonder.yaml");
		const config = parse(await readFile(file, "utf8"));
		config.plugins = config.plugins.filter((entry: { use: string }) => entry.use !== "@yonder/plugin-interaction");
		if (disabled) config.plugins.push({ use: "@yonder/plugin-interaction", config: { desktop: false } });
		await writeFile(file, stringify(config));
		const agent = await readFile(join(home, "agents/main/agent.yaml"), "utf8");
		const cli = resolve("packages/cli/dist/index.js");
		const child = spawn(process.execPath, [cli, "start", "--home", home, "--json"], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		const exited = once(child, "close");
		let output = "";
		child.stdout.on("data", (chunk) => {
			output += chunk;
		});
		child.stderr.on("data", (chunk) => {
			output += chunk;
		});
		const diagnostics = () => `CLI pid=${child.pid} exit=${child.exitCode} signal=${child.signalCode}\n${output}`;
		try {
			try {
				await expect
					.poll(
						async () => {
							if (child.exitCode !== null || child.signalCode !== null) return "exited";
							return requestControl(home, { method: "sessions.list" }).then(
								() => "ready",
								() => "starting",
							);
						},
						{ timeout: 10000 },
					)
					.not.toBe("starting");
				expect(child.exitCode, diagnostics()).toBeNull();
				expect(child.signalCode, diagnostics()).toBeNull();
			} catch (error) {
				throw new Error(`CLI control endpoint did not become ready. ${diagnostics()}`, { cause: error });
			}
			const updated = parse(await readFile(file, "utf8"));
			expect(updated.plugins.filter((entry: { use: string }) => entry.use === "@yonder/plugin-interaction")).toEqual([
				disabled
					? { use: "@yonder/plugin-interaction", config: { desktop: false } }
					: { use: "@yonder/plugin-interaction" },
			]);
			expect(await readFile(join(home, "agents/main/agent.yaml"), "utf8")).toBe(agent);
			const descriptor = join(home, ".yonder/plugins/interaction/desktop.json");
			await expect(readFile(descriptor, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
		} finally {
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				await Promise.race([
					(async () => {
						if (child.exitCode === null && child.signalCode === null)
							await requestControl(home, { method: "stop" }).catch(() => child.kill("SIGTERM"));
						await exited;
					})(),
					new Promise<never>((_, reject) => {
						timer = setTimeout(() => reject(new Error(`CLI did not exit after stop. ${diagnostics()}`)), 5000);
					}),
				]);
			} finally {
				clearTimeout(timer);
				if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
				await exited;
				await rm(home, { recursive: true, force: true });
			}
		}
	},
	20000,
);
