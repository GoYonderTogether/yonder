import type { PluginAPI } from "@yonder/sdk";
import type { Store } from "./store/index.js";

export function registerTaskViews(api: PluginAPI, store: Store): void {
	api.views.register(
		{ id: "tasks.board", plugin: "tasks", title: "Task board", placement: "rail", scope: "session" },
		{
			data(session) {
				if (!session) throw new Error("Session required");
				const tasks = store.forSession(session);
				return {
					viewId: "tasks.board",
					rev: Math.max(0, ...tasks.map(({ revision }) => revision)),
					content: {
						type: "list",
						items: tasks.map(({ task }) => ({ id: task.id, title: task.title, subtitle: task.state })),
					},
				};
			},
		},
	);
}
