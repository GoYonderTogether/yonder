import type { ViewDecl, ViewProvider } from "@yonder/sdk";
import type { Runtime } from "../runtime/index.js";

export function builtinViews(runtime: () => Runtime): Array<{ decl: ViewDecl; provider: ViewProvider }> {
	return (["rail", "floating"] as const).map((placement) => {
		const id = `core.background.${placement}`;
		return {
			decl: { id, plugin: "core", title: "后台任务", placement, scope: "session" },
			provider: {
				async data(session) {
					if (!session) throw new Error("Session required");
					const jobs = await runtime().backgroundList(session);
					return {
						viewId: id,
						rev: 0,
						content: {
							type: "list",
							items: jobs.map((job) => ({
								id: job.id,
								title: job.name,
								subtitle: job.state.status === "terminal" ? job.state.outcome.status : job.state.status,
							})),
						},
					};
				},
			},
		};
	});
}
