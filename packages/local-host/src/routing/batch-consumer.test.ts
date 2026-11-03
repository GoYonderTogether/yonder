import { batchConsumerForSource } from "@yonder/bot-core/routing/batch-consumer";
import { parseAgentConfig } from "@yonder/local-host/config/index";
import { createStore } from "@yonder/local-host/store/index";
import { openDatabase } from "@yonder/runtime-adapter/node/runtime/db";
import { expect, test } from "vitest";

test("batch consumer matching uses the actual plugin event shape and exact conversation/profile", async () => {
	const db = await openDatabase(":memory:");
	try {
		const store = await createStore(db);
		const agent = parseAgentConfig(`schema: 1
id: main
name: Main
owner: person:owner
defaultProfile: p1
profiles:
  p1: { plugins: [social] }
social: { enabled: true, scope: ["conv:qq:other"] }
bindings:
  - id: p1-source
    match: { type: message.in, channel: feishu, conv: "conv:feishu:p1" }
    session: { mode: persistent, per: conv }
    profile: p1
    wake: write
    reply: none
  - id: feishu-observer
    match: { type: message.in, channel: feishu, kind: group }
    session: { mode: persistent, per: conv }
    profile: p1
    wake: write
    reply: none
  - id: kind-filtered
    match: { type: social.batch-ready, channel: feishu, kind: group, conv: "conv:feishu:p1" }
    session: { mode: persistent, per: conv }
    profile: p1
    reply: none
`);
		const sourceBinding = agent.bindings.find((binding) => binding.id === "p1-source");
		if (!sourceBinding) throw new Error("source binding is missing");
		const source = {
			id: "source-1",
			ts: new Date(0).toISOString(),
			type: "message.in",
			from: "acct:feishu:member",
			conv: "conv:feishu:p1",
			data: { kind: "group", mentioned: true, text: "not copied into the batch event" },
		};
		const channel = { id: "feishu", kinds: ["group"] } as never;
		expect(await batchConsumerForSource(agent, source, sourceBinding, channel, store, "social")).toMatchObject({
			issue: "batch-consumer-unavailable",
			profile: "p1",
			plugin: "social",
			pluginSelected: true,
			matchingConsumer: false,
		});
		const invalidFirst = {
			id: "invalid-first",
			match: { type: "social.batch-ready", channel: "feishu", conv: "conv:feishu:p1" },
			session: { mode: "persistent" as const, per: "conv" as const },
			profile: "p1",
			reply: "none" as const,
			wake: "write" as const,
		};
		agent.bindings.push({
			id: "exact-consumer",
			match: { type: "social.batch-ready", channel: "feishu", conv: "conv:feishu:p1" },
			session: { mode: "persistent", per: "conv" },
			profile: "p1",
			reply: "none",
		});
		agent.bindings.splice(agent.bindings.length - 1, 0, invalidFirst);
		expect(await batchConsumerForSource(agent, source, sourceBinding, channel, store, "social")).toMatchObject({
			issue: "batch-consumer-unavailable",
			pluginSelected: true,
			matchingConsumer: false,
		});
		agent.bindings = agent.bindings.filter((binding) => binding.id !== "invalid-first");
		expect(await batchConsumerForSource(agent, source, sourceBinding, channel, store, "social")).toMatchObject({
			binding: { id: "exact-consumer" },
			profile: "p1",
			derived: false,
		});
	} finally {
		await db.close();
	}
});
