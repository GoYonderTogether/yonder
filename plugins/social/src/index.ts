import { definePlugin } from "@yonder/sdk";
import { Batches } from "./batches.js";
import { registerSocialTools } from "./tools.js";

export default definePlugin({
	setup(api) {
		const batches = new Batches(api);
		registerSocialTools(api);
		api.events.on("routing.social-decision", (event) => batches.accept(event));
		api.events.on("message.in", (event) => batches.direct(event));
		api.events.on("run.end", (event) => batches.finished(event));
		api.events.on("channel-qq.group-read", (event) => batches.legacyRead(event));
		api.triggers.register({ id: "social", start: () => batches.start(), stop: () => batches.stop() });
	},
});
