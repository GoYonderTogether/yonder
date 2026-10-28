import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { testModel } from "../config/test-support.js";
import { initHome, openKernel } from "./index.js";

// Real kernel, router and runtime. A real selected hook cancels the run before the provider request, so no model
// (and no model stub) is involved: this verifies admission and routing, not model output.
async function homeWithProbe(gateway?: { enabled: boolean }) {
	const home = await mkdtemp(join(tmpdir(), "ya-"));
	await initHome(home, "owner", { model: testModel });
	await writeFile(
		join(home, "package.json"),
		JSON.stringify({
			name: "console-probe",
			version: "0.0.0",
			type: "module",
			yonder: { apiVersion: 1, id: "console-probe", entry: "./probe.mjs", contributes: { hooks: ["probe"] } },
		}),
	);
	await writeFile(
		join(home, "probe.mjs"),
		`export default { setup(api) { api.hooks.register({ id: 'probe', async beforeRequest(messages, ctx) {
  const cancelled = new Promise(resolve => ctx.signal.addEventListener('abort', resolve, {once:true}));
  void api.sessions.abort(ctx.session);
  await cancelled;
} }); } };`,
	);
	const config = parse(await readFile(join(home, "yonder.yaml"), "utf8"));
	config.plugins.push({ use: home });
	if (gateway) config.gateway = gateway;
	await writeFile(join(home, "yonder.yaml"), stringify(config));
	const agentFile = join(home, "agents/main/agent.yaml");
	const agent = parse(await readFile(agentFile, "utf8"));
	agent.defaults.plugins.push("console-probe");
	await writeFile(agentFile, stringify(agent));
	return home;
}

test("console is a zero-config channel: the owner reaches the Bot's single main session", async () => {
	const home = await homeWithProbe();
	const file = join(home, "agents/main/agent.yaml");
	const agent = parse(await readFile(file, "utf8"));
	agent.bindings.find((binding: { session: unknown }) => binding.session === "main").busy = "interrupt";
	await writeFile(file, stringify(agent));
	const kernel = await openKernel(home);
	try {
		expect(await kernel.bots.list()).toEqual([{ agent: "main", name: "Jarvis", session: undefined }]);
		const sent = await kernel.bots.send("main", "你好");
		const session = await kernel.sessions.get(sent.session);
		expect(session).toMatchObject({ agent: "main", mode: "main", key: "main", profile: "owner" });
		const input = (await kernel.events.query({ id: sent.event })).events[0];
		expect(input).toMatchObject({ type: "message.in", from: "acct:console:owner", conv: "conv:console:main" });
		expect(input?.routes).toEqual([
			expect.objectContaining({ agent: "main", binding: "@console", session: sent.session, busy: "steer" }),
		]);
		// Same Bot session semantics as other channels: a second message lands in the same session; the Bot is listed with it.
		expect((await kernel.bots.send("main", "再来一条")).session).toBe(sent.session);
		expect((await kernel.bots.list())[0]?.session).toBe(sent.session);
		await expect(kernel.bots.send("nobody", "hi")).rejects.toThrow("Unknown bot");
	} finally {
		await kernel.close();
		await rm(home, { recursive: true, force: true });
	}
}, 60_000);

test("console entry is absent when the gateway is disabled", async () => {
	const home = await homeWithProbe({ enabled: false });
	const kernel = await openKernel(home);
	try {
		expect(await kernel.bots.list()).toEqual([]);
		await expect(kernel.bots.send("main", "hi")).rejects.toThrow("Unknown bot");
	} finally {
		await kernel.close();
		await rm(home, { recursive: true, force: true });
	}
}, 60_000);

async function withBinding(id: string, channel: string) {
	const home = await homeWithProbe();
	const file = join(home, "agents/main/agent.yaml");
	const agent = parse(await readFile(file, "utf8"));
	agent.bindings.push({ id, match: { channel, kind: "dm", from: "owner" }, session: "main" });
	await writeFile(file, stringify(agent));
	return home;
}

test("a user binding named @console is rejected by config validation", async () => {
	const home = await withBinding("@console", "console");
	try {
		await expect(openKernel(home)).rejects.toThrow("@console");
	} finally {
		await rm(home, { recursive: true, force: true });
	}
}, 60_000);

test("an explicit console binding overrides the implicit one and no user binding is dropped", async () => {
	const home = await withBinding("console", "console");
	const file = join(home, "agents/main/agent.yaml");
	const agent = parse(await readFile(file, "utf8"));
	agent.bindings.find((binding: { id: string }) => binding.id === "console").busy = "interrupt";
	await writeFile(file, stringify(agent));
	const kernel = await openKernel(home);
	try {
		const sent = await kernel.bots.send("main", "hi");
		const input = (await kernel.events.query({ id: sent.event })).events[0];
		expect(input?.routes).toEqual([
			expect.objectContaining({ binding: "console", session: sent.session, busy: "interrupt" }),
		]);
	} finally {
		await kernel.close();
		await rm(home, { recursive: true, force: true });
	}
}, 60_000);

test("a node has one owner: bots.list and bots.send only cover Bots owned by it, others log one warning", async () => {
	const home = await homeWithProbe();
	const config = parse(await readFile(join(home, "yonder.yaml"), "utf8"));
	config.identity = {
		...(config.identity ?? {}),
		persons: [...(config.identity?.persons ?? []), { id: "guest", name: "Guest" }],
	};
	config.agents.push({ id: "other", workspace: "agents/other" });
	await writeFile(join(home, "yonder.yaml"), stringify(config));
	await cp(join(home, "agents/main"), join(home, "agents/other"), { recursive: true });
	const file = join(home, "agents/other/agent.yaml");
	const agent = parse(await readFile(file, "utf8"));
	await writeFile(file, stringify({ ...agent, id: "other", name: "Other", owner: "person:guest" }));
	const logs: string[] = [];
	const kernel = await openKernel(home, { log: (level, message) => level === "warn" && logs.push(message) });
	try {
		expect((await kernel.bots.list()).map((bot) => bot.agent)).toEqual(["main"]);
		await expect(kernel.bots.send("other", "hi")).rejects.toThrow("Unknown bot");
		expect(logs.filter((line) => line.includes("Bot other"))).toHaveLength(1);
	} finally {
		await kernel.close();
		await rm(home, { recursive: true, force: true });
	}
}, 60_000);

test("plugins.list works with the built-in console channel loaded", async () => {
	const home = await homeWithProbe();
	const kernel = await openKernel(home);
	try {
		const plugins = (await kernel.management({ action: "plugins.list" } as never)) as Array<{ id: string }>;
		expect(plugins.map((plugin) => plugin.id)).toContain("channel-cli");
	} finally {
		await kernel.close();
		await rm(home, { recursive: true, force: true });
	}
}, 60_000);
