// Deprecated alias: the implementation lives in @yonder/plugin-learning.
// Keeps existing `use: "@yonder/plugin-hermes-experience"` configs loading under
// the old plugin id, tool names and data directory until `yonder migrate` moves them.
import learning from "@yonder/plugin-learning";
import { definePlugin } from "@yonder/sdk";

export default definePlugin({
	...learning,
	setup(api) {
		api.log?.warn("hermes-experience 已弃用，请改用 learning；将在 0.5 移除", {
			replacement: "@yonder/plugin-learning",
			removal: "0.5",
		});
		return learning.setup(api);
	},
});
