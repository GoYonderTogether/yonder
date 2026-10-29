import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initHome, openKernel } from "@yonder/core";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";

const cli = resolve("packages/cli/dist/index.js");
const auth = process.env.YONDER_TEST_AUTH ?? resolve(".yonder/auth.json");

function invoke(args: string[], input?: string) {
	return execFileSync(process.execPath, [cli, ...args], { encoding: "utf8", input });
}

/** 真实端口检查：能否建立到 127.0.0.1:<port> 的连接。 */
function listening(port: number) {
	return new Promise<boolean>((done) => {
		const socket = createConnection({ port, host: "127.0.0.1" });
		socket.once("connect", () => {
			socket.destroy();
			done(true);
		});
		socket.once("error", () => done(false));
	});
}

async function freePort() {
	const server = createServer();
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing loopback address");
	await new Promise<void>((done) => server.close(() => done()));
	return address.port;
}

/** 前台 `yonder start`，等到控制套接字出现；返回停止函数。 */
async function start(home: string) {
	const child = spawn(process.execPath, [cli, "start", "--home", home, "--no-gateway", "--json"], { stdio: "ignore" });
	const exited = once(child, "exit");
	await expect
		.poll(async () => (await stat(join(home, ".yonder/control.sock")).catch(() => null))?.isSocket() ?? false, {
			timeout: 15000,
		})
		.toBe(true);
	return async () => {
		child.kill("SIGTERM");
		await exited;
	};
}

test("init --bundle core writes no channel, no channel binding and model-free presets", async () => {
	const home = await mkdtemp(join(tmpdir(), "ya-"));
	try {
		invoke(["init", home, "--bundle", "core", "--model", "openai/gpt-6-luna", "--json"]);
		const config = parse(await readFile(join(home, "yonder.yaml"), "utf8"));
		expect(config.plugins.filter((entry: { use: string }) => entry.use.includes("channel"))).toEqual([]);
		expect(config.channels).toEqual({});
		const agent = parse(await readFile(join(home, "agents/main/agent.yaml"), "utf8"));
		expect(agent.bindings.map((binding: { match: { channel?: string } }) => binding.match.channel)).not.toContain(
			"cli",
		);
		for (const name of ["default", "research"]) {
			const preset = parse(await readFile(join(home, `presets/${name}.yaml`), "utf8"));
			expect(preset).not.toHaveProperty("model");
		}
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test("init rejects an unknown bundle id and advertises --bundle", () => {
	expect(invoke(["help"])).toContain("[--bundle core|default|full]");
	for (const shell of ["zsh", "bash"]) expect(invoke(["completion", shell])).toContain("--bundle");
	expect(invoke(["completion", "fish"])).toContain("-l bundle");
	try {
		invoke(["init", "--bundle", "everything"]);
		throw new Error("expected CLI usage failure");
	} catch (error) {
		expect(error).toMatchObject({ status: 2 });
		expect((error as { stderr: Buffer }).stderr.toString()).toContain("init --bundle accepts core, default, full");
	}
});

test("channels list reports shipped third-party channels as not enabled", async () => {
	const home = await mkdtemp(join(tmpdir(), "ya-"));
	let stop: (() => Promise<void>) | undefined;
	try {
		invoke(["init", home, "--model", "openai/gpt-6-luna", "--json"]);
		const config = parse(await readFile(join(home, "yonder.yaml"), "utf8"));
		expect(config.channels).toEqual({ cli: { type: "cli" }, card: { type: "card" } });
		stop = await start(home);
		const channels = JSON.parse(invoke(["channels", "list", "--home", home, "--json"])) as Array<{
			instance?: string;
			type?: string;
			status?: string;
		}>;
		expect(channels.find((channel) => channel.instance === "cli")).toEqual({
			instance: "cli",
			type: "cli",
			login: false,
		});
		for (const type of ["feishu", "wechat-ilink", "qq", "github"])
			expect(channels.find((channel) => channel.type === type)).toMatchObject({
				status: "随包提供，未启用 · Shipped, not enabled",
			});
	} finally {
		await stop?.();
		await rm(home, { recursive: true, force: true });
	}
}, 30000);

test("channel-mcp opens no port until an mcp channel instance is enabled", async () => {
	const home = await mkdtemp(join(tmpdir(), "ya-"));
	const port = await freePort();
	let stop: (() => Promise<void>) | undefined;
	try {
		invoke(["init", home, "--model", "openai/gpt-6-luna", "--json"]);
		const file = join(home, "yonder.yaml");
		const config = parse(await readFile(file, "utf8"));
		// 插件已加载、实例尚未配置：我们将要写进实例配置的那个端口此时不能有人监听。
		expect(config.plugins).toContainEqual({ use: "@yonder/plugin-channel-mcp" });
		expect(config.channels.mcp).toBeUndefined();
		stop = await start(home);
		expect(await listening(port)).toBe(false);
		await stop();
		stop = undefined;

		config.channels.mcp = { type: "mcp", port, credential: "mcp", account: "owner" };
		await writeFile(file, stringify(config));
		// 实际配置的端口取自落盘的 yonder.yaml，而不是测试里记下的变量。
		const configured = parse(await readFile(file, "utf8")).channels.mcp.port as number;
		expect(configured).toBe(port);
		stop = await start(home);
		await expect.poll(() => listening(configured), { timeout: 15000 }).toBe(true);
	} finally {
		await stop?.();
		await rm(home, { recursive: true, force: true });
	}
}, 45000);

test.skipIf(process.env.YONDER_TEST_REAL !== "1" || !existsSync(auth))(
	"a core-bundle home started with --no-gateway still converses",
	async () => {
		const home = await mkdtemp(join(tmpdir(), "ya-"));
		let stop: (() => Promise<void>) | undefined;
		try {
			invoke(["init", home, "--bundle", "core", "--model", "openai/gpt-6-luna", "--json"]);
			const config = parse(await readFile(join(home, "yonder.yaml"), "utf8"));
			config.credentials = auth;
			await writeFile(join(home, "yonder.yaml"), stringify(config));
			stop = await start(home);
			const reply = invoke(["chat", "--home", home, "--preset", "default"], "只输出数字：1+1 等于几？\n");
			expect(reply).toContain("2");
		} finally {
			await stop?.();
			await rm(home, { recursive: true, force: true });
		}
	},
	120000,
);

test("a non-default configured model reaches new tasks and resident templates", async () => {
	const home = await mkdtemp(join(tmpdir(), "ya-"));
	const model = "openai/gpt-6.1-sol";
	let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
	try {
		await initHome(home, "owner", { model });
		expect(parse(await readFile(join(home, "yonder.yaml"), "utf8")).defaultModel).toBe(model);
		kernel = await openKernel(home);
		const presets = kernel.terminal.presets();
		// 新任务：官方任务预设与 init 生成的 default 预设。
		for (const id of ["default", "coding", "research"])
			expect(presets.find((preset) => preset.id === id)).toMatchObject({ model });
		const task = await kernel.sessions.open({ preset: "default", close: "manual" });
		expect(task).toHaveProperty("profile", "default");
		// 常驻模板：用 jarvis 与 default-agent 各创建一个常驻 agent。
		for (const template of ["jarvis", "default-agent"]) {
			expect(presets.find((preset) => preset.id === template)).toMatchObject({ model });
			await kernel.management({
				action: "agents.create",
				id: `from-${template}`,
				preset: template,
				value: { name: template, work: "model check", owner: "person:owner", bindings: [] },
			});
			const agent = parse(await readFile(join(home, `agents/from-${template}/agent.yaml`), "utf8"));
			expect(Object.values(agent.profiles).every((profile) => (profile as { model?: string }).model === model)).toBe(
				true,
			);
		}
	} finally {
		await kernel?.close();
		await rm(home, { recursive: true, force: true });
	}
}, 30000);

test("init refuses a home without a model and the default bundle carries the §5.4 plugins", async () => {
	const home = await mkdtemp(join(tmpdir(), "ya-"));
	try {
		expect(() => invoke(["init", join(home, "none"), "--json"])).toThrow();
		invoke(["init", join(home, "ok"), "--model", "openai/gpt-6-luna", "--json"]);
		const config = parse(await readFile(join(home, "ok/yonder.yaml"), "utf8"));
		const used = config.plugins.map((entry: { use: string }) => entry.use);
		for (const name of ["cron", "tasks", "learning", "channel-card", "mcp-client", "memory"])
			expect(used).toContain(`@yonder/plugin-${name}`);
		expect(config.plugins.find((entry: { use: string }) => entry.use === "@yonder/plugin-memory").config).toMatchObject(
			{
				root: join(home, "ok/memory"),
				owner: "person:owner",
			},
		);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
