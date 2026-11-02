import Type, { type TSchema } from "typebox";
import { guardSession } from "./guard.js";
import type { MethodDef } from "./method-types.js";

const text = Type.String({ minLength: 1, maxLength: 4096 });
export const SessionOptionsProperties = {
	model: Type.Optional(text),
	effort: Type.Optional(
		Type.Union(
			(["auto", "off", "minimal", "low", "medium", "high", "xhigh", "max"] as const).map((level) =>
				Type.Literal(level),
			),
		),
	),
	permission: Type.Optional(text),
	resources: Type.Optional(
		Type.Array(
			Type.Object({ deviceId: text, paths: Type.Array(text, { maxItems: 64 }) }, { additionalProperties: false }),
			{ maxItems: 64 },
		),
	),
};
export const SessionOptionsSchema = Type.Object(SessionOptionsProperties, { additionalProperties: false });
const define = <P extends TSchema>(value: MethodDef<P>) => value as unknown as MethodDef;
export const workbenchOptionsMethods: MethodDef[] = [
	define({
		name: "models.list",
		scope: "owner",
		params: Type.Object({}),
		since: 1,
		handler: async (_p, ctx) => ctx.kernel.workbench.models(),
	}),
	define({
		name: "workspaces.list",
		scope: "owner",
		params: Type.Object({ id: Type.Optional(text), deviceId: Type.Optional(text), path: Type.Optional(text) }),
		since: 1,
		handler: async (p, ctx, signal) => {
			if (p.id) await guardSession(ctx, p.id);
			return ctx.kernel.workbench.workspaces(p, signal);
		},
	}),
	define({
		name: "sessions.options.get",
		scope: "owner",
		params: Type.Object({ id: text }),
		since: 1,
		async handler(p, ctx) {
			await guardSession(ctx, p.id);
			return ctx.kernel.workbench.get(p.id);
		},
	}),
	define({
		name: "sessions.options.set",
		scope: "owner",
		params: Type.Object({ id: text, ...SessionOptionsProperties }, { additionalProperties: false }),
		since: 1,
		async handler(p, ctx, signal) {
			await guardSession(ctx, p.id);
			const { id, ...options } = p;
			return ctx.kernel.workbench.set(id, options, signal);
		},
	}),
];
