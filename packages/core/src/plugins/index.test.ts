import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import type { KernelServices } from "./index.js";
import { loadPlugins } from "./index.js";

const unused = async (): Promise<never> => {
	throw new Error("unexpected plugin service call");
};

it("loads both first-party plugins through the manifest and registration checks", async () => {
	const home = await mkdtemp(join(tmpdir(), "ya-"));
	try {
		const services = {
			events: { emit: unused, ask: unused, query: unused },
			messages: { send: unused },
			credentials: { get: unused },
			sessions: {
				list: unused,
				get: unused,
				open: unused,
				submit: unused,
				abort: unused,
				close: unused,
				transcript: unused,
			},
			identity: {
				account: unused,
				person: unused,
				createPerson: unused,
				link: unused,
				unlink: unused,
				relation: unused,
				lookup: unused,
			},
			services: { resolve: unused },
			models: new Proxy(
				{},
				{
					get: () => {
						throw new Error("unexpected model access");
					},
				},
			),
			log: console,
		} as unknown as KernelServices;
		const plugins = await loadPlugins(
			home,
			{
				schema: 1,
				plugins: [
					{ use: "@yonder/plugin-channel-cli" },
					{ use: "@yonder/plugin-context-files" },
					{ use: "@yonder/plugin-browser-skill" },
					{ use: "@yonder/plugin-web-tools" },
				],
				channels: { cli: { type: "cli" } },
				envs: { local: { type: "local" } },
			},
			services,
		);
		expect([...plugins.channels.keys()]).toEqual(["console", "cli"]);
		expect([...plugins.contexts.keys()]).toEqual(["peer-workspace", "agents-md", "user-md", "soul-md", "memory-md"]);
		expect(plugins.envs.size).toBe(0);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

it("resolves home packages and serializes each plugin's observers without exposing mutable events", async () => {
	const home = await mkdtemp(join(tmpdir(), "ya-"));
	const directory = join(home, "node_modules/audit-plugin");
	const output = join(home, "observed.jsonl");
	try {
		await mkdir(directory, { recursive: true });
		await writeFile(
			join(directory, "package.json"),
			JSON.stringify({
				name: "audit-plugin",
				version: "1.0.0",
				type: "module",
				exports: { import: "./index.mjs" },
				yonder: { apiVersion: 1, id: "audit-plugin", entry: "./index.mjs", contributes: { triggers: ["audit"] } },
			}),
		);
		await writeFile(
			join(directory, "index.mjs"),
			`
import { appendFile } from "node:fs/promises";
export default { configSchema: {type: "object", required: ["output"], properties: {output: {type: "string"}}}, setup(api) {
  api.events.on("audit-plugin.check", async event => {
    if (event.data.n === 1) await new Promise(done => setTimeout(done, 20));
    await appendFile(api.config.output, JSON.stringify(event.data.n) + "\\n");
    event.data.n = 99;
    if (event.id === "1") throw new Error("observer failure");
  });
  api.triggers.register({ id: "audit", start: async io => { await io.emit({ type: "run.end", data: {} }); }, stop: async () => {} });
} };`,
		);
		const plugins = await loadPlugins(home, { schema: 1, plugins: [{ use: "audit-plugin", config: { output } }] }, {
			log: { error() {} },
		} as unknown as KernelServices);
		const event = { id: "1", ts: new Date().toISOString(), type: "audit-plugin.check", data: { n: 1 } };
		await Promise.all([plugins.observe(event), plugins.observe({ ...event, id: "2", data: { n: 2 } })]);
		expect(await readFile(output, "utf8")).toBe("1\n2\n");
		expect(event.data.n).toBe(1);
		await expect(
			loadPlugins(home, { schema: 1, plugins: [{ use: "audit-plugin" }] }, {} as KernelServices),
		).rejects.toThrow("invalid plugin config");
		await expect(plugins.start({ emit: unused, ask: unused })).rejects.toThrow(
			"event type must start with audit-plugin.",
		);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

it("only the provider registration can allow a channel to emit target", async () => {
	const home = await mkdtemp(join(tmpdir(), "ya-"));
	try {
		for (const allowed of [false, true]) {
			const directory = join(home, `provider-${allowed}`);
			await mkdir(directory);
			await writeFile(
				join(directory, "package.json"),
				JSON.stringify({
					version: "1.0.0",
					type: "module",
					yonder: {
						apiVersion: 1,
						id: "target-check",
						entry: "./index.mjs",
						contributes: { channels: ["target-check"] },
					},
				}),
			);
			await writeFile(
				join(directory, "index.mjs"),
				`export default {
  setup(api) {
    api.channels.register({
      type:'target-check', multiAgent:${allowed},
      create: id => ({
        id, multiAgent:true, kinds:['dm'], output:{stream:false,attachments:false},
        async start(io) { await io.emit({type:'message.in',from:'acct:input:user',conv:'conv:input:room',data:{kind:'dm',text:'input',target:'main'}}); },
        async stop() {}, async send() { return {ok:false}; }
      })
    });
  }
};`,
			);
			const plugins = await loadPlugins(
				home,
				{ schema: 1, plugins: [{ use: directory }], channels: { input: { type: "target-check" } } },
				{ log: { error() {} } } as unknown as KernelServices,
			);
			expect(plugins.channels.get("input")?.multiAgent).toBe(allowed);
			const emit = async (event: import("@yonder/sdk").EventInput) => ({
				...event,
				id: "1",
				ts: new Date().toISOString(),
			});
			if (allowed) await expect(plugins.start({ emit, ask: unused })).resolves.toBeUndefined();
			else await expect(plugins.start({ emit, ask: unused })).rejects.toThrow("cannot specify target");
			await plugins.stop();
		}
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

it("skips one channel instance with invalid config and keeps the others (JV2-J09-03)", async () => {
	const home = await mkdtemp(join(tmpdir(), "ya-"));
	try {
		const directory = join(home, "picky");
		await mkdir(directory);
		await writeFile(
			join(directory, "package.json"),
			JSON.stringify({
				version: "1.0.0",
				type: "module",
				yonder: { apiVersion: 1, id: "picky", entry: "./index.mjs", contributes: { channels: ["picky"] } },
			}),
		);
		await writeFile(
			join(directory, "index.mjs"),
			`export default { setup(api) { api.channels.register({
  type: "picky", configSchema: { type: "object", required: ["appId"], properties: { appId: { type: "string" } } },
  create: id => ({ id, kinds: ["dm"], output: { stream: false, attachments: false }, async start() {}, async stop() {}, async send() { return { ok: false }; } })
}); } };`,
		);
		const logged: unknown[] = [];
		const plugins = await loadPlugins(
			home,
			{
				schema: 1,
				plugins: [{ use: directory }],
				channels: { good: { type: "picky", appId: "x" } as { type: string }, bad: { type: "picky" } },
			},
			{ log: { error: (...args: unknown[]) => logged.push(args) } } as unknown as KernelServices,
		);
		expect([...plugins.channels.keys()]).toContain("good");
		expect(plugins.channels.has("bad")).toBe(false);
		expect(plugins.channelErrors.get("bad")).toContain("appId");
		expect(plugins.channelErrors.has("good")).toBe(false);
		expect(logged).toHaveLength(1);
		await plugins.start({ emit: unused, ask: unused });
		await plugins.stop();
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

it("rejects a user-declared channels.console because the id is reserved for the built-in console", async () => {
	const home = await mkdtemp(join(tmpdir(), "ya-"));
	try {
		const services = {} as unknown as KernelServices;
		await expect(
			loadPlugins(
				home,
				{ schema: 1, plugins: [{ use: "@yonder/plugin-channel-cli" }], channels: { console: { type: "cli" } } },
				services,
			),
		).rejects.toThrow("channels.console: reserved for the built-in console channel");
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
