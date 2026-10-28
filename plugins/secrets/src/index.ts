import { definePlugin } from "@yonder/sdk";
import { registerFindPut } from "./find-put.js";
import { registerUse } from "./use.js";
import { registerVault } from "./vault.js";

export default definePlugin({
	setup(api) {
		registerVault(api);
		registerUse(api);
		registerFindPut(api);
	},
});
