import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { resolveProfile } from "../config/index.js";
import { openDatabase } from "./db.js";
import { Runtime } from "./index.js";
import type { TodoUpdatedEvent } from "./todo.js";

const auth = process.env.YONDER_TEST_AUTH ?? resolve(".yonder/auth.json");
const catalog = process.env.YONDER_TEST_MODELS ?? resolve(homedir(), ".pi/agent/models.json");
const model = process.env.YONDER_TEST_MODEL ?? "workbuddy/deepseek-v4.1-flash";
const real = process.env.YONDER_TEST_REAL === "1" && existsSync(auth) && existsSync(catalog);

test.skipIf(!real)(
	"real model drives the todo tool; the list survives restart and each change emits todo.updated",
	async () => {
		const home = await mkdtemp("/tmp/yonder-todo-");
		const provider = model.slice(0, model.indexOf("/"));
		const providers = JSON.parse(readFileSync(catalog, "utf8")).providers;
		const events: TodoUpdatedEvent[] = [];
		const profile = resolveProfile({ model, thinking: "low", level: "readonly", tools: { offer: ["todo"] } });
		const dbPath = `${home}/state.db`;
		const open = async () =>
			Runtime.open({
				home,
				db: await openDatabase(dbPath),
				config: {
					schema: 1,
					credentials: auth,
					compaction: { enabled: false },
					models: { providers: { [provider]: providers[provider] } },
				},
				resolveSession: async () => ({ agent: null, profile: "todo", cwd: home, resolved: profile }),
				onTodo: async (event) => {
					events.push(event);
				},
			});
		let runtime = await open();
		try {
			const session = await runtime.create({ agent: null, profile: "todo", cwd: home });
			const first = await runtime.submit(session, {
				text: 'Use the todo tool: create a task "Draft outline", then a task "Write summary" blocked by the first task, then mark the first task in_progress. Then reply OK.',
			});
			expect(first.status, first.reason).toBe("done");
			expect(events.length).toBeGreaterThanOrEqual(3);
			expect(events.at(-1)).toMatchObject({
				session,
				done: 0,
				total: 2,
				items: [
					{ id: "1", state: "doing", order: 0 },
					{ id: "2", text: expect.stringMatching(/summary/iu), state: "todo", order: 1 },
				],
			});
			await runtime.close();
			runtime = await open();
			const second = await runtime.submit(session, {
				text: "Use the todo tool to list the tasks, mark task 1 completed, then reply with the subjects you saw.",
			});
			expect(second.status, second.reason).toBe("done");
			expect(second.text).toMatch(/outline/iu);
			expect(events.at(-1)).toMatchObject({ done: 1, total: 2, items: [{ id: "1", state: "done" }, { id: "2" }] });
		} finally {
			await runtime.close();
			await rm(home, { recursive: true, force: true });
		}
	},
	200000,
);
