import Type, { type TSchema } from "typebox";
import type { MethodDef } from "./method-types.js";

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
		}),
		since: 1,
		handler: async (p, ctx) =>
			ctx.kernel.sessions.open({
				preset: p.preset,
				...(p.close ? { close: p.close } : {}),
				...(p.parent ? { parent: p.parent } : {}),
			}),
	}),
];
