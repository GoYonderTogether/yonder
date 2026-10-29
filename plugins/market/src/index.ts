import { definePlugin } from "@yonder/sdk";
import { Type } from "typebox";
import { endpointOf, MarketClient } from "./client.js";
import { registerMarketTools } from "./tools.js";
import { registerMarketView } from "./views.js";
import { WatchRunner } from "./watch.js";

export default definePlugin({
	configSchema: Type.Object(
		{
			/** 社交云端地址；缺省与 channel-card 相同的默认值。 */
			endpoint: Type.Optional(Type.String({ minLength: 1 })),
			/** yonder.yaml credentials 文件里的设备令牌凭据名。 */
			credential: Type.Optional(Type.String({ minLength: 1 })),
		},
		{ additionalProperties: false },
	),
	setup(api) {
		const config = (api.config ?? {}) as { endpoint?: string; credential?: string };
		const endpoint = endpointOf(config.endpoint);
		const credential = config.credential ?? "market";
		/** 每次调用现取令牌，主人登录或换令牌后无需重启插件。 */
		const client = async (): Promise<MarketClient | undefined> => {
			const auth = await api.credentials.get(credential);
			if (auth?.type !== "api_key" || !auth.key) return undefined;
			return new MarketClient(endpoint, auth.key);
		};
		const watch = new WatchRunner(api, client);
		registerMarketTools(api, { client, watch });
		registerMarketView(api, { client, watch });
		api.triggers.register({ id: "market", start: () => watch.start(), stop: () => watch.stop() });
	},
});
