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
				"Read QQ bot transport state and actual inbound/outbound counts. To configure QQ for the user, run the returned setup executable with --home <Yonder home> --agent <agent id> [--open] using an authorized local exec tool. It prints an official binding link/QR before waiting, saves credentials without displaying them, and configures DM plus group @ bindings. Forward the link immediately from process output. A ready connection alone is not receive/reply acceptance.",
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
