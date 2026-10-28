import { definePlugin } from "@yonder/sdk";
import { Batches } from "./batches.js";

export default definePlugin({
	setup(api) {
		const batches = new Batches(api);
		api.events.on("routing.social-decision", (event) => batches.accept(event));
		api.events.on("message.in", (event) => batches.direct(event));
		api.events.on("run.end", (event) => batches.finished(event));
		api.triggers.register({ id: "social", start: () => batches.start(), stop: () => batches.stop() });
	},
});
