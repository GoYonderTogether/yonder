import { expect, test } from "vitest";
import { createCoreTools } from "../tools/index.js";
import { createSubagentTool } from "./subagents.js";

// Stubbed store/runtime only resolve the delegation depth; no model or real session is involved.
const rows: Record<string, { mode: string; parent?: string }> = {
	"1": { mode: "persistent" },
	"2": { mode: "task", parent: "1" },
	"3": { mode: "task", parent: "2" },
};

function build() {
	const dispatched: string[] = [];
	const runtime = {
		assertToolContext: () => {},
		authorizeAttachments: async () => {},
		runTask: async () => {
			dispatched.push("run");
			throw new Error("dispatch reached");
		},
	};
	const tools = createCoreTools({
		store: { sessions: { get: async (id: string) => rows[id] } } as never,
		agents: new Map(),
		sessions: {} as never,
		runtime: () => runtime as never,
		delivery: {} as never,
		ask: async () => {
			throw new Error("Delegation depth tests never ask");
		},
		getPreset: (id: string) => ({ id, description: "depth" }) as never,
	});
	return {
		subagent: createSubagentTool(
			() => runtime as never,
			() => tools,
		),
		dispatched,
	};
}

const ctx = (session: string) =>
	({
		agent: "main",
		profile: "child",
		session,
		capabilities: ["read"],
		env: { id: "node:local" },
		signal: new AbortController().signal,
	}) as never;

test("subagent action=run is rejected on the third delegation layer", async () => {
	const { subagent, dispatched } = build();
	const result = await subagent.execute({ action: "run", options: { preset: "child", task: "third layer" } }, ctx("3"));
	expect(result).toMatchObject({ isError: true });
	expect((result as { text: string }).text).toContain("任务已嵌套两层");
	expect(dispatched).toEqual([]);
});

test("subagent action=run still delegates at the allowed depth", async () => {
	const { subagent, dispatched } = build();
	const result = await subagent.execute(
		{ action: "run", options: { preset: "child", task: "second layer" } },
		ctx("2"),
	);
	expect((result as { text: string }).text).toBe("dispatch reached");
	expect(dispatched).toEqual(["run"]);
});
