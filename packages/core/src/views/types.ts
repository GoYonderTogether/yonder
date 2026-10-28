import type { Placement, ViewContent, ViewData, ViewDecl, ViewsChangedEv } from "@yonder/sdk";

export interface ViewFilter {
	placement?: Placement;
	session?: string;
}
export interface KernelViews {
	list(filter?: ViewFilter): ViewDecl[];
	data(viewId: string, session?: string): Promise<ViewData>;
	act(viewId: string, action: string, input?: unknown, session?: string): Promise<{ content?: ViewContent }>;
	watch(filter?: ViewFilter): AsyncIterableIterator<ViewsChangedEv>;
}
