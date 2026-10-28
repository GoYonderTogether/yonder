import Type, { type TSchema } from "typebox";
import type { MethodDef } from "./method-types.js";

const text = Type.String({ minLength: 1 });
const obj = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties);
const noParams = obj({});
function define<P extends TSchema>(def: MethodDef<P>): MethodDef {
	// SAFETY: registry.prepare validates params before invoking handlers.
	return def as unknown as MethodDef;
}

import { dedupe } from "./submit-dedupe.js";

export const botMethods: MethodDef[] = [
	define({
		name: "bots.list",
		scope: "owner",
		params: noParams,
		since: 1,
		handler: async (_p, ctx) => ({ bots: await ctx.kernel.bots.list() }),
	}),
	define({
		name: "bots.send",
		scope: "owner",
		params: obj({ agent: text, text, requestId: Type.Optional(text) }),
		since: 1,
		async handler(p, ctx) {
			const run = () => ctx.kernel.bots.send(p.agent, p.text);
			return p.requestId ? dedupe(`bot:${p.agent}`, p.requestId, run) : run();
		},
	}),
];
