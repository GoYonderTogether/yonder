import { Buffer } from "node:buffer";
import type { ViewDecl, ViewProvider, ViewsChangedEv } from "@yonder/sdk";
import type { KernelViews, ViewFilter } from "./types.js";

export type { KernelViews } from "./types.js";

const invalid = (): never => {
	throw Object.assign(new Error("invalid_params"), { code: "invalid_params" });
};

function validateInput(input: unknown): void {
	if (input === undefined) return;
	const plain = (value: object) => [Object.prototype, null].includes(Object.getPrototypeOf(value));
	if (input !== null && (typeof input !== "object" || !plain(input))) invalid();
	const json = (value: unknown): void => {
		if (value === null || typeof value === "string" || typeof value === "boolean") return;
		if (typeof value === "number" && Number.isFinite(value)) return;
		if (typeof value !== "object" || (!Array.isArray(value) && !plain(value))) invalid();
		for (const item of Object.values(value as object)) json(item);
	};
	try {
		json(input);
		if (Buffer.byteLength(JSON.stringify(input), "utf8") > 16384) invalid();
	} catch {
		invalid();
	}
}

export function createViews() {
	const entries = new Map<string, { decl: ViewDecl; provider: ViewProvider }>();
	const listeners = new Set<(event: ViewsChangedEv) => void>();
	const pending = new Map<string, number | undefined>();
	let scheduled = false;
	const get = (id: string, session?: string) => {
		const entry = entries.get(id);
		if (!entry) throw Object.assign(new Error(`Unknown view: ${id}`), { code: "not_found" });
		if (entry.decl.scope === "session" && !session) invalid();
		return entry;
	};
	const api: KernelViews = {
		list: (filter = {}) =>
			[...entries.values()]
				.map(({ decl }) => decl)
				.filter((decl) => !filter.placement || decl.placement === filter.placement)
				.sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
				.map((decl) => structuredClone(decl)),
		async data(id, session) {
			const { provider } = get(id, session);
			const data = await provider.data(session);
			if (data.viewId !== id) throw new Error("View provider returned another view's data");
			return data;
		},
		async act(id, action, input, session) {
			const { decl, provider } = get(id, session);
			if (
				typeof action !== "string" ||
				!/^[a-z0-9][a-z0-9_.-]{0,63}$/.test(action) ||
				(decl.actions && !decl.actions.includes(action))
			)
				invalid();
			validateInput(input);
			if (!provider.act) return invalid();
			return provider.act(action, input, session);
		},
		watch(filter: ViewFilter = {}) {
			const queue: ViewsChangedEv[] = [];
			let wake: (() => void) | undefined;
			let closed = false;
			const listener = (event: ViewsChangedEv) => {
				if (filter.placement && filter.placement !== event.placement) return;
				queue.push(structuredClone(event));
				wake?.();
			};
			listeners.add(listener);
			return {
				[Symbol.asyncIterator]() {
					return this;
				},
				async next() {
					while (!closed && !queue.length)
						await new Promise<void>((resolve) => {
							wake = resolve;
						});
					const value = queue.shift();
					return value ? { done: false as const, value } : { done: true as const, value: undefined };
				},
				async return() {
					closed = true;
					queue.length = 0;
					listeners.delete(listener);
					wake?.();
					return { done: true as const, value: undefined };
				},
			};
		},
	};
	return {
		api,
		...api,
		register(plugin: string, decl: ViewDecl, provider: ViewProvider) {
			if (
				decl.plugin !== plugin ||
				(plugin !== "core" && (!decl.id.startsWith(`${plugin}.`) || decl.id.length === plugin.length + 1))
			)
				throw new Error("View must belong to its declaring plugin");
			if (entries.has(decl.id)) throw new Error(`${decl.id}: contribution conflict`);
			if (decl.actScope === "read") throw new Error("View actions require at least write scope");
			entries.set(decl.id, { decl: structuredClone(decl), provider });
		},
		invalidate(plugin: string, ids?: string[], badge?: number) {
			const selected =
				ids ?? [...entries.values()].filter(({ decl }) => decl.plugin === plugin).map(({ decl }) => decl.id);
			for (const id of selected)
				if (entries.get(id)?.decl.plugin !== plugin) throw new Error("Cannot invalidate another plugin's view");
			for (const id of selected) pending.set(id, badge ?? pending.get(id));
			if (scheduled || !pending.size) return;
			scheduled = true;
			queueMicrotask(() => {
				scheduled = false;
				const groups = new Map<ViewsChangedEv["placement"], ViewsChangedEv>();
				for (const [id, badge] of pending) {
					const entry = entries.get(id);
					if (!entry) continue;
					const placement = entry.decl.placement;
					const event = groups.get(placement) ?? { placement, ids: [] };
					event.ids.push(id);
					if (badge !== undefined) {
						event.badge ??= {};
						event.badge[id] = badge;
					}
					groups.set(placement, event);
				}
				pending.clear();
				for (const event of groups.values()) for (const listener of listeners) listener(event);
			});
		},
	};
}
