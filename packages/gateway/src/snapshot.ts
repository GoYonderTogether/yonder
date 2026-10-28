import { type HostCtx, registry } from "@yonder/core";

/** Keep both consumers on the same authorised metadata read. */
export function sessionMetadata(id: string, ctx: HostCtx) {
	return registry.call("sessions.show", { id, include: "meta" }, ctx, new AbortController().signal);
}

/** Existing ready snapshot, with the same read order and return shape. */
export async function sessionSnapshot(id: string, ctx: HostCtx) {
	const meta = (await sessionMetadata(id, ctx)) as object;
	const transcript = await registry.call("sessions.transcript", { id }, ctx, new AbortController().signal);
	return { ...meta, transcript };
}
