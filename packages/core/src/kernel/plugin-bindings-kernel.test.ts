import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentBindingRequest, PluginAPI, ToolContext } from "@yonder/sdk";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { openKernel } from "./index.js";

test("real kernel revalidates persisted private plugin binding after restart and rejects fabricated tool context", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-binding-"));
	const key = `binding-probe-${home}`;
	const globals = globalThis as unknown as Record<string, PluginAPI>;
	let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
	const request: AgentBindingRequest = {
		id: "updates",
		eventType: "archive-probe.watch",
		conv: "conv:archive-probe:watch:main:updates",
		profile: "owner",
		notification: { to: "owner", via: "test" },
	};
	try {
		await mkdir(join(home, "probe"));
		await mkdir(join(home, "agents/main"), { recursive: true });
		await writeFile(
			join(home, "probe/package.json"),
			JSON.stringify({
				type: "module",
				version: "1.0.0",
				yonder: {
					apiVersion: 1,
					id: "archive-probe",
					entry: "./index.mjs",
					contributes: { tools: ["archive-probe_status"], channels: ["binding-dm"] },
				},
			}),
		);
		await writeFile(
			join(home, "probe/index.mjs"),
			`export default { setup(api) {
			globalThis[${JSON.stringify(key)}] = api;
			api.channels.register({type:'binding-dm',create(id){return {id,kinds:['dm'],output:{stream:false,attachments:false},async start(){},async stop(){},async send(){return {ok:true}}}}});
			api.tools.register({name:'archive-probe_status',description:'Inspect transport test state',parameters:{type:'object',properties:{}},capabilities:['read'],async execute(){return {text:'ok'}}});
		}};`,
		);
		await writeFile(
			join(home, "yonder.yaml"),
			stringify({
				schema: 1,
				defaultModel: "openai/gpt-6-luna",
				plugins: [{ use: "./probe" }],
				agents: [{ id: "main", workspace: "./agents/main" }],
				channels: { test: { type: "binding-dm" } },
				identity: { persons: [{ id: "owner", name: "owner", accounts: ["acct:test:owner"] }] },
			}),
		);
		await writeFile(
			join(home, "agents/main/agent.yaml"),
			stringify({
				schema: 1,
				id: "main",
				name: "Main",
				owner: "person:owner",
				defaultProfile: "owner",
				profiles: { owner: { level: "bypass", plugins: ["archive-probe"] } },
				bindings: [
					{
						id: "owner",
						match: { channel: "console", kind: "dm", from: "owner" },
						session: "main",
						profile: "owner",
						wake: "write",
					},
					{
						id: "archive-probe:updates",
						match: { type: request.eventType, conv: request.conv },
						session: { mode: "persistent", per: "conv" },
						profile: "owner",
						wake: "run",
						reply: "none",
					},
				],
			}),
		);
		kernel = await openKernel(home);
		const receipt = await kernel.bots.send("main", "Prepare private binding verification without a model run");
		const owner = { session: receipt.session, agent: "main", profile: "owner" };
		const route = await globals[key]!.agents.inspectBinding(request, owner);
		expect(route.notification).toEqual({ to: "acct:test:owner", via: "test" });
		await expect(
			globals[key]!.agents.configureBinding(request, {
				...owner,
				capabilities: ["read", "write", "admin"],
			} as ToolContext),
		).rejects.toThrow("真实运行");
		await kernel.close();
		kernel = undefined;
		kernel = await openKernel(home);
		expect(await globals[key]!.agents.inspectBinding(request, owner)).toEqual(route);
		const file = join(home, "agents/main/agent.yaml");
		const agent = parse(await readFile(file, "utf8"));
		agent.profiles.owner.tools = { offer: [], search: [] };
		await kernel.management({ action: "agents.update", id: "main", value: { profiles: agent.profiles } });
		await expect(globals[key]!.agents.inspectBinding(request, owner)).rejects.toThrow("message_send");
		const runs = await kernel.events.query({ type: "run.start" });
		expect(runs.events).toHaveLength(0);
	} finally {
		await kernel?.close();
		delete globals[key];
		await rm(home, { recursive: true, force: true });
	}
}, 30000);
