import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const shape = (value: unknown): unknown =>
	Array.isArray(value)
		? [shape(value[0])]
		: value && typeof value === "object"
			? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shape(item)]))
			: typeof value;

import { outboundQueue } from "./outbound.js";

test("digest survives restart and rechecks every queued owner's capability", async () => {
	const events: Array<{ id: string; type: string; ts: string; data: unknown }> = [];
	const agent = { social: { enabled: true }, owner: "person:owner" };
	const agents = new Map([["bot", agent]]);
	let allowed = true;
	const notices: string[] = [];
	const store = {
		events: {
			query: async ({ type }: { type: string }) => ({ events: events.filter((e) => e.type === type) }),
			get: async (id: string) => events.find((e) => e.id === id),
			record: async (input: { type: string; data: unknown }) => {
				const event = { ...input, id: String(events.length + 1), ts: new Date(0).toISOString() };
				events.push(event);
				return event;
			},
		},
		sessions: {
			get: async (id: string) => ({ id, agent: "bot", profile: "main" }),
			list: async () => [{ id: "main" }],
		},
	};
	const sessions = {
		resolveSession: async () => ({ resolved: { capabilities: allowed ? ["message"] : [] } }),
		notifyFrom: async (_id: string, input: { text: string }) => {
			notices.push(input.text);
		},
	};
	const args = {
		store,
		sessions,
		agents,
		config: { notifications: { outbound: { mode: "immediate" } } },
		delivery: () => ({}),
	} as unknown as Parameters<typeof outboundQueue>[0];
	await store.events.record({ type: "source", data: {} });
	const owner = { agent: "bot", session: "1", profile: "main" };
	const queue = outboundQueue(args);
	await queue.enqueue(owner, "tasks", "需要决定", { kind: "decision", key: "task:1", sourceEvents: ["1"] });
	await outboundQueue(args).flush();
	expect(notices).toEqual(["需要决定"]);
	await queue.enqueue(owner, "tasks", "已撤权", { kind: "decision", key: "task:2", sourceEvents: ["1"] });
	allowed = false;
	await queue.flush();
	allowed = true;
	await queue.flush();
	expect(notices).toEqual(["需要决定"]);
	const actual = Object.fromEntries(
		["notification.intent", "notification.final"].map((type) => [
			type,
			shape(events.find((event) => event.type === type)?.data),
		]),
	);
	const golden = new URL("./outbound.golden.json", import.meta.url);
	if (process.env.UPDATE_GOLDEN === "1") {
		writeFileSync(golden, `${JSON.stringify(actual, null, "\t")}\n`);
		execFileSync("npx", ["biome", "format", "--write", fileURLToPath(golden)]);
	}
	expect(actual).toEqual(JSON.parse(readFileSync(golden, "utf8")));
});
