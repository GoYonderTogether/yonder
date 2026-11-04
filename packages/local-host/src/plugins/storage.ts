import { guardStorage } from "@yonder/bot-core/plugins/storage";
import { createFilePluginStorage } from "@yonder/sdk/node-storage";

export { guardStorage } from "@yonder/bot-core/plugins/storage";
export const pluginStorage = (data: string, deny: (operation: string) => void) =>
	guardStorage(createFilePluginStorage(data), deny);
