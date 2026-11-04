import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { openKernel } from "@yonder/local-host/kernel/index";
import type { ChannelIO, PluginAPI } from "@yonder/sdk";
import { tempHome } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { stringify } from "yaml";

test("real plugin caller identity and selected batch namespace govern replaceable participation admission", async () => {
	const home = await tempHome("yonder-participation-plugin-");
	const key = `participation-${randomUUID()}`;
	const globals = globalThis as unknown as Record<string, { chosen?: PluginAPI; other?: PluginAPI; io?: ChannelIO }>;
	globals[key] = {};
	let kernel: Awaited<ReturnType<typeof openKernel>> | undefined;
	try {
		for (const id of ["chosen", "other"]) {
			await mkdir(join(home, id));
			await writeFile(
				join(home, id, "package.json"),
				JSON.stringify({
					name: id,
					version: "1.0.0",
					type: "module",
					yonder: {
						apiVersion: 1,
						id,
						entry: "index.mjs",
						contributes: id === "chosen" ? { channels: ["participation-test"], hooks: ["advance"] } : {},
					},
				}),
			);
			await writeFile(
				join(home, id, "index.mjs"),
				id === "chosen"
					? `export default {setup(api){
 globalThis[${JSON.stringify(key)}].chosen=api;
 // 真实的参与策略插件：内核按 SocialPolicy.plugin 选它，并由它给出判定（04 §3.6）。
 api.hooks.register({id:'advance',participation(input){
   const social=input.agent.social??{};
   const {createHash}=process.getBuiltinModule('node:crypto');
   const revision=createHash('sha256').update(JSON.stringify(social)).digest('hex');
   if((social.denied??[]).includes(input.event.conv)) return {reason:'denied',run:false,revision};
   return input.facts.bound||(social.authorized?.conversations??[]).includes(input.event.conv)
     ? {reason:'batch',run:false,revision,policy:{mode:'batch'}}
     : {reason:'not-authorized',run:false,revision};
 }});
 api.channels.register({type:'participation-test',create(id){return {id,kinds:['group'],output:{stream:false,attachments:false},async start(io){globalThis[${JSON.stringify(key)}].io=io},async stop(){},async send(){throw Error('No platform sends in participation contract test')}}}});
}};`
					: `export default {setup(api){globalThis[${JSON.stringify(key)}].other=api}};`,
			);
		}
		await mkdir(join(home, "agents/main"), { recursive: true });
		await writeFile(
			join(home, "yonder.yaml"),
			stringify({
				schema: 1,
				defaultModel: "openai/gpt-6-luna",
				plugins: [{ use: "./chosen" }, { use: "./other" }],
				channels: { room: { type: "participation-test" } },
				agents: [{ id: "main", workspace: "./agents/main" }],
			}),
		);
		await writeFile(
			join(home, "agents/main/agent.yaml"),
			stringify({
				schema: 1,
				id: "main",
				name: "Main",
				owner: "person:owner",
				defaultProfile: "group",
				profiles: { group: { plugins: ["chosen"], contexts: [], skills: [], tools: { offer: [], search: [] } } },
				social: {
					enabled: true,
					authorized: { conversations: ["conv:room:group"] },
					defaults: { group: { plugin: "chosen", mode: "batch", batch: { run: true } } },
				},
				bindings: [
					{
						id: "group",
						match: { channel: "room", kind: "group" },
						session: { mode: "persistent", per: "conv" },
						wake: "write",
					},
					{
						// 消费者必须是 wake:run + reply:none 的独立 persistent/per:conv 绑定（08 §192）。
						id: "batch",
						match: { type: "chosen.batch-ready", channel: "room" },
						session: { mode: "persistent", per: "conv" },
						reply: "none",
						wake: "run",
					},
				],
			}),
		);
		kernel = await openKernel(home);
		const { chosen, other, io } = globals[key];
		if (!chosen?.social || !other?.social || !io) throw Error("Real plugin participation API unavailable");
		const source = await io.emit({
			type: "message.in",
			from: "acct:room:owner",
			conv: "conv:room:group",
			data: { kind: "group", text: "我们产品得有品味", msgId: randomUUID() },
		});
		const route = source.routes?.find((item) => item.agent === "main" && item.wake === "write");
		if (!route?.session) throw Error("Missing real group write route");
		const fact = (await kernel.events.query({ type: "routing.social-decision" })).events.find(
			(event) => event.parent === source.id,
		);
		const revision = (fact?.data as { revision?: string } | undefined)?.revision;
		if (!revision) throw Error("Missing real policy decision revision");
		const request = {
			agent: "main",
			conv: source.conv!,
			through: source.id,
			sourceEvents: [source.id],
			policyRevision: revision,
		};
		expect(await chosen.social.admitBatch(request)).toEqual({ session: route.session });
		expect(await other.social.admitBatch(request)).toBeUndefined();
		const batch = await chosen.events.emit({
			type: "chosen.batch-ready",
			from: "plugin:chosen",
			conv: source.conv!,
			data: { ...request, msgId: randomUUID() },
		});
		// 批次沿消费者绑定自身的唤醒方式进入运行；消费者是 wake:run，不再伪装成 write。
		expect(batch.routes).toMatchObject([{ agent: "main", session: route.session, wake: "run" }]);
		const wrong = await other.events.emit({
			type: "other.batch-ready",
			from: "plugin:other",
			conv: source.conv!,
			data: { ...request, msgId: randomUUID() },
		});
		expect(wrong.routes).toMatchObject([{ agent: "main", binding: null, dropped: "no-binding" }]);
		expect(() =>
			other.events.emit({ type: "chosen.batch-ready", from: "plugin:chosen", conv: source.conv!, data: request }),
		).toThrow("other: event type must start with other.");
		expect((await kernel.events.query({ type: "message.out" })).events).toHaveLength(0);
	} finally {
		await kernel?.close();
		delete globals[key];
		await rm(home, { recursive: true, force: true });
	}
}, 30000);
