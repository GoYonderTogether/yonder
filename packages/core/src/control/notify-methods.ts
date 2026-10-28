import Type, { type TSchema } from "typebox";
import type { MethodDef } from "./method-types.js";

function define<P extends TSchema>(def: MethodDef<P>): MethodDef {
	return def as unknown as MethodDef;
}

export const notifyMethods: MethodDef[] = [
	define({
		name: "notifications.prefs.get",
		scope: "read",
		params: Type.Object({}),
		since: 1,
		async handler(_params, ctx) {
			return ctx.kernel.notifications.get();
		},
	}),
	define({
		name: "notifications.prefs.set",
		scope: "write",
		params: Type.Object({
			conv: Type.String({ minLength: 1 }),
			level: Type.Union([
				Type.Literal("all"),
				Type.Literal("mention"),
				Type.Literal("mentions"),
				Type.Literal("mute"),
				Type.Null(),
			]),
		}),
		since: 1,
		async handler(params, ctx) {
			await ctx.kernel.notifications.set(params.conv, params.level);
			return { ok: true };
		},
	}),
];
