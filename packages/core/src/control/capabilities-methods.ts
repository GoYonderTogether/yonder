import { EVENT_TYPES } from "@yonder/protocol/gateway";
import Type, { type TSchema } from "typebox";
import type { MethodDef } from "./method-types.js";

const obj = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties);
const noParams = obj({});
function define<P extends TSchema>(def: MethodDef<P>): MethodDef {
	// SAFETY: registry.prepare validates params before invoking handlers.
	return def as unknown as MethodDef;
}

import { PROTOCOL } from "./method-types.js";
import { registry } from "./methods.js";

export const capabilitiesMethods: MethodDef[] = [
	define({
		name: "capabilities.get",
		scope: "read",
		params: noParams,
		since: 1,
		async handler(_params, ctx) {
			const info = await ctx.releaseInfo();
			const plugins = (await ctx.kernel.management({ action: "plugins.list" } as never)) as Array<{
				id: string;
				version?: string;
			}>;
			return {
				protocol: PROTOCOL,
				kind: ctx.principal.kind,
				version: { yonder: info.version, commit: info.origin?.commit ?? null },
				methods: registry.facts(ctx.principal),
				events: EVENT_TYPES,
				plugins: plugins.map((plugin) => ({ id: plugin.id, version: plugin.version ?? "", views: [] })),
				granted: ctx.principal.scopes,
				limits: { maxSubs: 64, attachmentMaxBytes: 0, transcriptPage: 50 },
				features: { requestIdDedupe: true, resumableWatch: true },
			};
		},
	}),
];
