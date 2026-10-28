import { type HostCtx, MethodError, type Principal } from "./method-types.js";

/** Filter session rows already carrying their mode; owner callers retain every row. */
export function filterTaskOnly<T extends { mode: string }>(principal: Principal, items: T[]): T[] {
	return principal.scopes.includes("owner") ? items : items.filter((item) => item.mode === "task");
}

/** Bot conversations (every non-task session) need `owner` scope; task sessions keep the plain read/write scopes. */
export const ownsBots = (ctx: HostCtx) => ctx.principal.scopes.includes("owner");
export async function guardSession(ctx: HostCtx, id: string, session?: { mode: string }) {
	const row = session ?? (await ctx.kernel.sessions.get(id));
	if (row && row.mode !== "task" && !ownsBots(ctx))
		throw new MethodError("forbidden", "Bot conversations require owner scope");
}

/** Ids of the sessions a caller without `owner` may see; `undefined` means no restriction. */
export async function visibleSessionFilter(
	ctx: HostCtx,
): Promise<((id: string | undefined) => Promise<boolean>) | undefined> {
	if (ownsBots(ctx)) return undefined;
	const cache = new Map<string, boolean>();
	return async (id) => {
		if (!id) return false;
		let ok = cache.get(id);
		if (ok === undefined) {
			const row = await ctx.kernel.sessions.get(id);
			ok = row?.mode === "task";
			cache.set(id, ok);
		}
		return ok;
	};
}
