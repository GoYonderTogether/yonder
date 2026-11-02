import { budgetViewDecl, budgetView as sharedBudgetView } from "@yonder/bot-core/views/budget";
import type { YonderConfig } from "@yonder/bot-definition";
import { createStore } from "@yonder/local-host/store/index";
import type { Db } from "@yonder/runtime-adapter/contracts";
import type { ViewProvider } from "@yonder/sdk";

export * from "@yonder/bot-core/views/budget";

/** Legacy local view adapter; the shared view consumes Store rather than a host database. */
export function budgetView(host: { db: Db; config: YonderConfig }) {
	let store: ReturnType<typeof createStore> | undefined;
	const provider: ViewProvider = {
		async data(session) {
			store ??= createStore(host.db, undefined, true);
			const view = sharedBudgetView({ store: await store, config: host.config });
			return view.provider.data(session);
		},
	};
	return { decl: budgetViewDecl, provider };
}
