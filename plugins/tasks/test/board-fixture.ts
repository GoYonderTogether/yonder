import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ChannelIO, Hook, OutMessage, PluginAPI, Tool, ToolContext, Trigger } from "@yonder/sdk";
import { stringify } from "yaml";
import { openKernel } from "../../../packages/core/src/kernel/index.js";
import type { Config } from "../src/moments.js";
import { Store } from "../src/store/index.js";

export async function fixture(
	config: Config = {},
	options: { ui?: boolean; feishuBase?: string; avatarUrl?: string } = {},
) {
	const home = await mkdtemp(join(tmpdir(), "yonder-task-moments-"));
	const manifest = JSON.parse(await readFile(resolve("plugins/tasks/package.json"), "utf8"));
	manifest.yonder.entry = "./probe.mjs";

	manifest.yonder.contributes.channels = ["task-test"];
	await writeFile(join(home, "package.json"), JSON.stringify(manifest));
	// Capture actual registrations and channel I/O; store, loader and kernel are real.
	await writeFile(
		join(home, "probe.mjs"),
		`import tasks from ${JSON.stringify(pathToFileURL(resolve("plugins/tasks/dist/index.js")).href)};
export let api;
export let io, channel;
${options.feishuBase ? `import {FeishuChannel} from ${JSON.stringify(pathToFileURL(resolve("plugins/channel-feishu/dist/channel.js")).href)};` : ""}
export const tools = [], sent = [], triggers = [], hooks = [];
export default { configSchema: tasks.configSchema, setup(value) {
  api = value;
  tasks.setup({...api,
    hooks: {register(hook) {hooks.push(hook); api.hooks.register(hook);}},
    tools: {register(tool) {tools.push(tool); api.tools.register(tool);}},
    triggers: {register(trigger) {triggers.push(trigger); api.triggers.register(trigger);}}
  });
  api.channels.register({type:'task-test', create(id) {return {
    id, kinds:['dm'], output:{stream:false, attachments:true}, async start(value) {io=value;
      ${
				options.feishuBase
					? `channel = new FeishuChannel(id, {appId:'local-protocol', secret:'unused'}, {...api, paths:{data: ${JSON.stringify(join(home, ".yonder/plugins/channel-feishu"))}}});
      channel.client.raw = (path, method='GET', body, signal) => fetch(${JSON.stringify(options.feishuBase)} + path, {method, headers: body instanceof FormData ? {} : {'Content-Type':'application/json'}, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined, signal});
      await channel.start(value);`
					: ""
			}
    }, async stop() {await channel?.stop();},
    async send(target, message, signal) {sent.push(message); return channel ? channel.send(target, message, signal) : {ok:true};}
  };}});
}};`,
	);
	await mkdir(join(home, "agents/main"), { recursive: true });
	await writeFile(
		join(home, "yonder.yaml"),
		stringify({
			schema: 1,
			locale: "zh-CN",
			plugins: [
				{ use: home, config },
				...(options.ui ? [{ use: resolve("plugins/interaction"), config: { desktop: false } }] : []),
			],
			agents: [{ id: "main", workspace: "./agents/main" }],
			channels: { reminder: { type: "task-test" } },
		}),
	);
	await writeFile(
		join(home, "agents/main/agent.yaml"),
		stringify({
			schema: 1,
			id: "main",
			name: "Task moments protocol test",
			...(options.avatarUrl ? { avatarUrl: options.avatarUrl } : {}),
			owner: "person:test",
			defaultProfile: "owner",
			profiles: {
				owner: {
					model: "openai/gpt-6-luna",
					capabilities: ["read", "write", "network"],
					plugins: ["tasks"],
					contexts: ["tasks-turn"],
					tools: { offer: ["tasks_*", "read"], search: [] },
				},
			},
			bindings: [{ id: "seed", match: { type: "tasks.seed" }, session: "main", wake: "write" }],
		}),
	);
	let kernel = await openKernel(home, { log() {} });
	const probe = (await import(pathToFileURL(join(home, "probe.mjs")).href)) as {
		api: PluginAPI;
		channel: import("../../channel-feishu/src/channel.js").FeishuChannel;
		tools: Tool[];
		hooks: Hook[];
		io: ChannelIO;
		sent: OutMessage[];
		triggers: Trigger[];
	};
	const seed = await probe.api.events.emit({ type: "tasks.seed", data: {} });
	const session = seed.routes![0]!.session!;
	const ctx: ToolContext = {
		agent: "main",
		session,
		profile: "owner",
		capabilities: ["read", "write", "cross-agent"],
		env: {} as never,
		signal: new AbortController().signal,
	};
	const store = new Store(probe.api.paths.data);
	const call = (name: string, args: object, caller = ctx) =>
		probe.tools.find((tool) => tool.name === `tasks_${name}`)!.execute(args, caller);
	return {
		home,
		probe,
		ctx,
		store,
		call,
		kernel: () => kernel,
		async restart() {
			await kernel.close();
			kernel = await openKernel(home, { log() {} });
		},
		async close() {
			await kernel.close();
			store.close();
			await rm(home, { recursive: true, force: true });
		},
	};
}
