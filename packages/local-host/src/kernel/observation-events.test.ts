import { observedRuntimeEvents } from "@yonder/local-host/kernel/observation-events";
import { createStore } from "@yonder/local-host/store/index";
import { openDatabase } from "@yonder/runtime-adapter/node/runtime/db";
import type { TodoUpdatedEvent } from "@yonder/runtime-adapter/runtime/todo";
import type { ModelFallbackEvent } from "@yonder/runtime-adapter/types";
import type { SessionUpdate } from "@yonder/sdk";
import { expect, test } from "vitest";

test("model.fallback and todo.updated reach the session observer in order and are recorded identically", async () => {
	const db = await openDatabase(":memory:");
	try {
		const store = await createStore(db);
		const watched: SessionUpdate[] = [];
		const events = observedRuntimeEvents(store, (session, update) => {
			if (session === "7") watched.push(update);
		});
		const fallback: ModelFallbackEvent = {
			session: "7",
			state: "fallback",
			from: { provider: "a", model: "one" },
			to: { provider: "b", model: "two" },
			reason: "rate_limit",
		};
		const todo: TodoUpdatedEvent = {
			session: "7",
			done: 0,
			total: 1,
			items: [{ id: "1", text: "write", state: "doing", order: 0 }],
		};
		await events.onModelFallback(fallback);
		await events.onTodo(todo);
		await events.onTodo({ ...todo, session: "8" });
		expect(watched).toEqual([
			{ type: "model.fallback", session: "7", event: fallback },
			{ type: "todo.updated", session: "7", event: todo },
		]);
		const recorded = (await store.events.query({})).events.map((event) => [event.type, event.data]);
		expect(recorded).toEqual([
			["model.fallback", fallback],
			["todo.updated", todo],
			["todo.updated", { ...todo, session: "8" }],
		]);
	} finally {
		await db.close();
	}
});
