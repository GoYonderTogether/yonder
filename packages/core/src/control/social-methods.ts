import Type, { type TSchema } from "typebox";
import { socialPolicySchema } from "../config/social-schema.js";
import { SocialError } from "../kernel/social.js";
import { type MethodDef, MethodError } from "./method-types.js";

const text = Type.String({ minLength: 1 });
const mapping = Type.Object({ subject: text, agent: text, profile: text });
const patch = Type.Object(
	{ ...socialPolicySchema.properties, mappings: Type.Optional(Type.Array(mapping)) },
	{ additionalProperties: false },
);
function define<P extends TSchema>(def: MethodDef<P>): MethodDef {
	return def as unknown as MethodDef;
}

async function call<T>(action: () => Promise<T>): Promise<T> {
	try {
		return await action();
	} catch (error) {
		if (error instanceof SocialError) throw new MethodError(error.code, error.message, error.data);
		throw error;
	}
}

export const socialMethods: MethodDef[] = [
	define({
		name: "social.inspect",
		scope: "read",
		since: 1,
		params: Type.Object({ agent: text, conv: text, event: Type.Optional(text) }),
		handler: async (params, ctx) => call(() => ctx.kernel.social.inspect(params, ctx.principal)),
	}),
	define({
		name: "social.update",
		scope: "admin",
		since: 1,
		params: Type.Object({
			agent: text,
			conv: text,
			expectedRevision: text,
			patch,
			reason: text,
			dryRun: Type.Optional(Type.Boolean({ default: true })),
		}),
		handler: async (params, ctx) => call(() => ctx.kernel.social.update(params, ctx.principal)),
	}),
];
