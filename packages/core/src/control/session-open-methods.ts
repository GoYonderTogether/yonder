import Type, { type TSchema } from "typebox";
import type { MethodDef } from "./method-types.js";
import { MethodError } from "./method-types.js";
import { SessionOptionsSchema } from "./workbench-options-methods.js";

const text = Type.String({ minLength: 1 });
const obj = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties);
function define<P extends TSchema>(def: MethodDef<P>): MethodDef {
	// SAFETY: registry.prepare validates params before invoking handlers.
	return def as unknown as MethodDef;
}

export const sessionOpenMethods: MethodDef[] = [
	define({
		name: "sessions.open",
		scope: "write",
		params: obj({
			preset: text,
			close: Type.Optional(Type.Union([Type.Literal("manual"), Type.Literal("run-end")])),
			parent: Type.Optional(text),
			options: Type.Optional(SessionOptionsSchema),
		}),
		since: 1,
		handler: async (p, ctx, signal) => {
			if (p.options && !ctx.principal.scopes.includes("owner"))
				throw new MethodError("forbidden", "Session options require owner scope");
			const request = {
				preset: p.preset,
				...(p.close ? { close: p.close } : {}),
				...(p.parent ? { parent: p.parent } : {}),
			};
			return p.options ? ctx.kernel.workbench.open(request, p.options, signal) : ctx.kernel.sessions.open(request);
		},
	}),
];
