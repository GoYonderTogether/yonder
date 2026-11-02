import { fileURLToPath } from "node:url";
import { allowsChannelInstance, definePlugin, type TSchema } from "@yonder/sdk";
import { type Config, configSchema, QQChannel } from "./channel.js";

export default definePlugin({
	setup(api) {
		const instances = new Map<string, QQChannel>();
		api.channels.register({
			type: "qq",
			configSchema: configSchema as TSchema,
			create(id, config) {
				const channel = new QQChannel(id, config as Config, api);
				instances.set(id, channel);
				return channel;
			},
		});
		api.tools.register({
			name: "channel-qq_status",
			capabilities: ["read"],
			description:
				"Read QQ transport state, counts, group batch/read positions, local group filters and per-group ingress observations. Platform receive scope is unknown because this plugin does not query QQ bot_state. A recorded GROUP_MESSAGE_CREATE proves only that one ordinary event was received by this instance/group at that time; it does not prove an ongoing all-message setting. Absence of an observed event is not a platform permission error. Report scope as unknown unless an official status or platform error confirms a restriction. To configure QQ, run the returned setup executable with --home <Yonder home> --agent <agent id> [--open] using authorized local exec. Forward its official binding link/QR immediately while it waits; credentials are saved without display. A ready connection alone does not prove receive/reply acceptance.",
			parameters: { type: "object", additionalProperties: false, properties: {} } as TSchema,
			async execute(_input, ctx) {
				return {
					text: JSON.stringify({
						instances: [...instances.values()].filter((c) => allowsChannelInstance(ctx, c.id)).map((c) => c.status()),
						setup: {
							executable: process.execPath,
							args: [fileURLToPath(new URL("./setup.js", import.meta.url)), "setup"],
							requires: ["--home", "--agent"],
							optional: ["--open", "--instance", "--profile", "--group-profile"],
						},
					}),
				};
			},
		});
	},
});
