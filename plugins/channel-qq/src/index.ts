import { fileURLToPath } from "node:url";
import { definePlugin, type TSchema } from "@yonder/sdk";
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
				"Read QQ bot transport state, actual counts and group batch/read positions. To configure QQ, run the returned setup executable with --home <Yonder home> --agent <agent id> [--open] using authorized local exec. Forward its official binding link/QR immediately while it waits; credentials are saved without display. It configures owner DM and read-only group participation. The group owner must also open that specific group's robot management in mobile QQ, select this bot, and set its message scope to all. The bot's own global settings do not grant group access. A ready connection is not receive/reply acceptance.",
			parameters: { type: "object", additionalProperties: false, properties: {} } as TSchema,
			async execute() {
				return {
					text: JSON.stringify({
						instances: [...instances.values()].map((c) => c.status()),
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
