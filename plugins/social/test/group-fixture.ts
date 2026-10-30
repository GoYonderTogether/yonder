import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ChannelIO, Delivery, PluginAPI, ToolContext } from "@yonder/sdk";
import { stringify } from "yaml";
import { openKernel } from "../../../packages/core/src/kernel/index.js";
import { groupInstructions } from "../../channel-qq/src/participation.js";

export const mainConv = "conv:qq-main:group:main-group";
export const gptConv = "conv:qq-gpt:group:gpt-group";
export const privateConv = "conv:qq-main:private";
export interface GroupProbe {
	api: PluginAPI;
	socialApi?: PluginAPI;
	ios: Record<string, ChannelIO>;
	sent: Array<{ to: string; text: string }>;
	contexts: ToolContext[];
	releases: Map<string, () => void>;
	results: Delivery[];
	onRequest?: (ctx: ToolContext) => Promise<void>;
}

/** Real kernel/social hooks and resident sessions; only delivery stays on a local recording transport. */
export async function groupFixture(
	options: {
		social?: boolean;
		authSource?: string;
		model?: string;
		allowProvider?: boolean;
		captureSocialApi?: boolean;
		initialRules?: Record<string, unknown>;
		identities?: Record<string, string>;
		review?: { intervalHours?: number; minMessages?: number };
	} = {},
) {
	const home = await mkdtemp("/tmp/yonder-group-delivery-");
	const key = `group-delivery-${randomUUID()}`;
	const globals = globalThis as unknown as Record<string, GroupProbe>;
	let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
	try {
		if (options.captureSocialApi) {
			await mkdir(join(home, "social-capture"));
			const manifest = JSON.parse(await readFile(resolve("plugins/social/package.json"), "utf8"));
			manifest.yonder.entry = "index.mjs";
			await writeFile(join(home, "social-capture/package.json"), JSON.stringify(manifest));
			await writeFile(
				join(home, "social-capture/index.mjs"),
				`import plugin from ${JSON.stringify(pathToFileURL(resolve("plugins/social/src/index.ts")).href)};
export default {...plugin,setup(api){globalThis[${JSON.stringify(`${key}:social`)}]=api;return plugin.setup(api);}};`,
			);
		}
		await mkdir(join(home, "probe"));
		await mkdir(join(home, "presets"));
		await writeFile(
			join(home, "probe/package.json"),
			JSON.stringify({
				name: "group-delivery-probe",
				version: "1.0.0",
				type: "module",
				yonder: {
					apiVersion: 1,
					id: "delivery-probe",
					entry: "index.mjs",
					contributes: { channels: ["group-delivery"], hooks: ["hold"] },
				},
			}),
		);
		await writeFile(
			join(home, "probe/index.mjs"),
			`export default {setup(api){
const state={api,socialApi:globalThis[${JSON.stringify(`${key}:social`)}],ios:{},sent:[],contexts:[],releases:new Map(),results:[]}; globalThis[${JSON.stringify(key)}]=state;
api.hooks.register({id:'hold',async beforeRequest(messages,ctx){
state.contexts.push(ctx);
await new Promise(resolve=>{state.releases.set(ctx.session,resolve);if(ctx.signal.aborted)resolve();else ctx.signal.addEventListener('abort',resolve,{once:true});});
ctx.signal.throwIfAborted();if(state.onRequest)await state.onRequest(ctx);
if(!${Boolean(options.allowProvider)})throw Error('GROUP_DELIVERY_PROBE_BEFORE_PROVIDER');
}});
api.channels.register({
  type:'group-delivery',
  create(id){
    return {
      id,kinds:['group','dm'],output:{stream:false,attachments:false},
      async start(io){state.ios[id]=io},async stop(){},
      async send(to,msg){state.sent.push({to,text:msg.text});return {ok:true,id:'local-'+state.sent.length}}
    };
  }
});
}};`,
		);
		await writeFile(
			join(home, "yonder.yaml"),
			stringify({
				schema: 1,
				defaultModel: options.model ?? "openai/gpt-6-luna",
				...(options.authSource ? { credentials: resolve(options.authSource) } : {}),
				plugins: [
					{
						use: options.captureSocialApi ? "./social-capture" : resolve("plugins/social"),
						config: {
							groupJudge: {
								preset: "group-judge",
								rooms: [[mainConv, gptConv]],
								...(options.initialRules ? { initialRules: options.initialRules } : {}),
								...(options.identities ? { identities: options.identities } : {}),
								...(options.review ? { review: options.review } : {}),
							},
						},
					},
					{ use: "./probe" },
				],
				channels: { "qq-main": { type: "group-delivery" }, "qq-gpt": { type: "group-delivery" } },
				identity: { persons: [{ id: "owner", name: "Owner", accounts: ["acct:qq-main:owner", "acct:qq-gpt:owner"] }] },
				agents: [
					{ id: "main", workspace: "./agents/main" },
					{ id: "gpt-senpai", workspace: "./agents/gpt-senpai" },
				],
			}),
		);
		await writeFile(
			join(home, "presets/group-judge.yaml"),
			stringify({
				schema: 1,
				description: "Group judgment",
				capabilities: [],
				plugins: [],
				contexts: [],
				skills: [],
				tools: { offer: [], search: [] },
			}),
		);
		for (const [id, instance, conv] of [
			["main", "qq-main", mainConv],
			["gpt-senpai", "qq-gpt", gptConv],
		]) {
			await mkdir(join(home, `agents/${id}`), { recursive: true });
			const profile = {
				model: options.model ?? "openai/gpt-6-luna",
				cheap: options.model ?? "openai/gpt-6-luna",
				capabilities: ["message"],
				plugins: ["social", "delivery-probe"],
				contexts: [],
				skills: [],
				channelInstances: [instance],
				instructions: groupInstructions,
				tools: { offer: ["message_send"], search: [] },
			};
			await writeFile(
				join(home, `agents/${id}/agent.yaml`),
				stringify({
					schema: 1,
					id,
					name: id === "main" ? "贾维斯" : "GPT 学姐",
					owner: "person:owner",
					defaultProfile: "group",
					profiles: { group: profile, private: profile },
					...(options.social
						? {
								social: {
									enabled: true,
									scope: [conv],
									authorized: { conversations: [conv] },
									defaults: { group: { mode: "batch", batch: { run: true, delaySeconds: 3 }, minIntervalSeconds: 1 } },
								},
							}
						: {}),
					bindings: [
						{
							id: "group",
							match: { channel: instance, kind: "group" },
							session: { mode: "persistent", per: "conv" },
							profile: "group",
							wake: "mention",
							reply: "none",
						},
						{
							id: "group-batch",
							match: { type: "social.batch-ready", channel: instance },
							session: { mode: "persistent", per: "conv" },
							profile: "group",
							reply: "none",
						},
						{
							id: "private",
							match: { channel: instance, kind: "dm" },
							session: { mode: "persistent", per: "conv" },
							profile: "private",
							wake: "write",
							reply: "none",
						},
					],
				}),
			);
		}
		kernel = await openKernel(home);
		return {
			home,
			kernel,
			probe: globals[key],
			async close() {
				for (const release of globals[key]?.releases.values() ?? []) release();
				await kernel?.close();
				delete globals[key];
				delete globals[`${key}:social`];
				await rm(home, { recursive: true, force: true });
			},
		};
	} catch (error) {
		await kernel?.close();
		delete globals[key];
		delete globals[`${key}:social`];
		await rm(home, { recursive: true, force: true });
		throw error;
	}
}
