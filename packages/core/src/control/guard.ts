import { type HostCtx, MethodError } from "./method-types.js";

/** Bot conversations (every non-task session) need `owner` scope; task sessions keep the plain read/write scopes. */
export const ownsBots = (ctx: HostCtx) => ctx.principal.scopes.includes("owner");
export async function guardSession(ctx: HostCtx, id: string, session?: { mode: string }) {
	const row = session ?? (await ctx.kernel.sessions.get(id));
	if (row && row.mode !== "task" && !ownsBots(ctx))
		throw new MethodError("forbidden", "Bot conversations require owner scope");
}
