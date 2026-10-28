import type { PluginAPI, SocialAPI } from "@yonder/sdk";
import { Type } from "typebox";

const text = Type.String({ minLength: 1 });
const target = { agent: text, conv: text };
export function registerSocialTools(api: PluginAPI) {
	const service = () => {
		if (!api.social) throw new Error("Social API unavailable");
		return api.social;
	};
	api.tools.register({
		name: "social_inspect",
		description: "Inspect a conversation's effective social reply policy and revision.",
		capabilities: ["read"],
		parameters: Type.Object({ ...target, event: Type.Optional(text) }, { additionalProperties: false }),
		async execute(args, ctx) {
			return result(() => service().inspect(args as Parameters<SocialAPI["inspect"]>[0], ctx));
		},
	});
	api.tools.register({
		name: "social_update",
		description:
			"Preview or apply a social reply policy change. First inspect, then preview. For @-only replies set mode to mention and signals botMention to respond, ownerMention/groupOwner/everyone/keyword to record. Ask the owner to send 确认 as a separate message after preview, then apply with dryRun false and the same arguments.",
		capabilities: ["admin"],
		parameters: Type.Object(
			{
				...target,
				expectedRevision: text,
				patch: Type.Object(
					{
						mode: Type.Optional(
							Type.Union(["direct", "record", "mention", "batch", "folded", "mute"].map((v) => Type.Literal(v))),
						),
						batch: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
						minIntervalSeconds: Type.Optional(Type.Number()),
						signals: Type.Optional(Type.Record(Type.String(), Type.String())),
						keywords: Type.Optional(Type.Array(text)),
						quiet: Type.Optional(Type.Object({ timezone: text, start: text, end: text })),
						foldedEverySeconds: Type.Optional(Type.Number()),
						judge: Type.Optional(Type.Object({ preset: text, maxCallsPerHour: Type.Optional(Type.Number()) })),
					},
					{ additionalProperties: false },
				),
				reason: text,
				dryRun: Type.Optional(Type.Boolean()),
			},
			{ additionalProperties: false },
		),
		async execute(args, ctx) {
			return result(() => service().update(args as Parameters<SocialAPI["update"]>[0], ctx));
		},
	});
}
async function result(action: () => Promise<unknown>) {
	try {
		return { text: JSON.stringify(await action()) };
	} catch (error) {
		return { text: error instanceof Error ? error.message : String(error), isError: true };
	}
}
