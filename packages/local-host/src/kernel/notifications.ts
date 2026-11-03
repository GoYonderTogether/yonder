import { createNotificationPrefs as create } from "@yonder/bot-core/kernel/notifications";
import type { NotificationConfig } from "@yonder/bot-definition/notifications";
import type { Db } from "@yonder/runtime-adapter/contracts";
import { notificationStore } from "../store/state.js";

export * from "@yonder/bot-core/kernel/notifications";
export const createNotificationPrefs = (db: Db, config: NotificationConfig | undefined) =>
	create(notificationStore(db), config);
