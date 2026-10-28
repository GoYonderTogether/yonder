export type Placement = "rail" | "floating" | "page";
export type BuiltinViewId =
	| "todos"
	| "goal"
	| "subtasks"
	| "attachments"
	| "context"
	| "background"
	| "subagents"
	| "wakes";
export interface ViewDecl {
	id: string;
	plugin: string;
	title: string;
	placement: Placement;
	scope: "session" | "node";
	data?: string;
	icon?: string;
	order?: number;
	actions?: string[];
	actScope?: "read" | "write" | "admin" | "owner";
	needs?: { methods?: string[] };
}
export type ViewContent =
	| { type: "markdown"; text: string }
	| {
			type: "list";
			items: {
				id: string;
				title: string;
				subtitle?: string;
				state?: "todo" | "doing" | "done" | "error" | "info";
				actions?: { id: string; label: string; danger?: boolean }[];
			}[];
	  }
	| { type: "kv"; rows: { k: string; v: string }[] }
	| { type: "choice"; prompt: string; options: { id: string; label: string }[]; multi?: boolean }
	| { type: "input"; prompt: string; placeholder?: string; secret?: false }
	| { type: "builtin"; id: BuiltinViewId; payload: unknown };
export interface ViewData {
	viewId: string;
	rev: number;
	content: ViewContent;
	badge?: number;
}
export interface ViewProvider {
	data(session?: string): ViewData | Promise<ViewData>;
	act?(
		action: string,
		input?: unknown,
		session?: string,
	): { content?: ViewContent } | Promise<{ content?: ViewContent }>;
}
export interface ViewsChangedEv {
	placement: Placement;
	ids: string[];
	badge?: Record<string, number>;
}
export interface SessionSettledEv {
	session: string;
	status: "idle" | "done" | "error" | "aborted";
}

export interface PluginViewsAPI {
	views: { register(decl: ViewDecl, provider: ViewProvider): void };
	invalidate(ids?: string[], badge?: number): void;
}
