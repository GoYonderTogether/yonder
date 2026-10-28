// Deprecated alias: the implementation lives in @yonder/plugin-learning.
// Keeps existing `use: "@yonder/plugin-hermes-experience"` configs loading under
// the old plugin id, tool names and data directory until `yonder migrate` moves them.
import learning from "@yonder/plugin-learning";
import { definePlugin } from "@yonder/sdk";

export default definePlugin({
	...learning,
	setup(api) {
		api.log?.warn(
			"plugin hermes-experience is deprecated; switch `use` to @yonder/plugin-learning (id learning) via `yonder migrate`",
			{ replacement: "@yonder/plugin-learning" },
		);
		return learning.setup(api);
	},
});
