import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChannelIO, PluginAPI } from "@yonder/sdk";
import { expect, test } from "vitest";
import { stringify } from "yaml";
import { openKernel } from "./index.js";

test("real plugin caller identity and selected batch namespace govern replaceable participation admission", async () => {
	const home = await mkdtemp("/tmp/yonder-participation-plugin-");
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
						contributes: id === "chosen" ? { channels: ["participation-test"] } : {},
					},
				}),
			);
			await writeFile(
				join(home, id, "index.mjs"),
				id === "chosen"
					? `export default {setup(api){
 globalThis[${JSON.stringify(key)}].chosen=api;
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
						id: "batch",
						match: { type: "chosen.batch-ready", channel: "room" },
						session: { mode: "persistent", per: "conv" },
						reply: "none",
						wake: "mention",
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
		expect(batch.routes).toMatchObject([{ agent: "main", session: route.session, wake: "write" }]);
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
