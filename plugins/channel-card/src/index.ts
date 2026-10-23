import { definePlugin } from "@yonder/sdk";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { CardChannel, type Config } from "./channel.js";

export const configSchema = Type.Object(
	{
		endpoint: Type.Optional(Type.String()),
		device: Type.Optional(
			Type.Object(
				{ kind: Type.Optional(Type.Union(["laptop", "desktop", "server"].map((v) => Type.Literal(v)))) },
				{ additionalProperties: false },
			),
		),
	},
	{ additionalProperties: false },
);
const parameters = Type.Object(
	{
		instance: Type.String({ minLength: 1 }),
		title: Type.String(),
		markdown: Type.String(),
		display: Type.Optional(
			Type.Object(
				{ kind: Type.Union([Type.Literal("html"), Type.Literal("svg")]), source: Type.String() },
				{ additionalProperties: false },
			),
		),
	},
	{ additionalProperties: false },
);

export default definePlugin({
	setup(api) {
		const instances = new Map<string, CardChannel>();
		api.channels.register({
			type: "card",
			multiAgent: true,
			configSchema,
			create(id, config) {
				if (instances.has(id)) throw new Error("Duplicate card instance");
				const channel = new CardChannel(id, config as Config, api);
				instances.set(id, channel);
				return channel;
			},
		});
		api.tools.register({
			name: "channel-card_card_push",
			description:
				"Draft the calling Agent's own card for human review. Does not publish. Supply a configured card instance, title, markdown and optional HTML/SVG display.",
			capabilities: ["write", "network"],
			parameters,
			async execute(input, ctx) {
				if (!Check(parameters, input)) return { isError: true, text: "Invalid card parameters" };
				const { instance, ...data } = input;
				const channel = instances.get(instance);
				if (!channel) return { isError: true, text: "Unknown card instance" };
				try {
					return { text: JSON.stringify(await channel.cardPush(ctx.agent, data, ctx.signal)) };
				} catch {
					return { isError: true, text: "Card draft failed; check instance and Agent registration" };
				}
			},
		});
	},
});
