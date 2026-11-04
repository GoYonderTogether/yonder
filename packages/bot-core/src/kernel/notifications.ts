import type { NotificationConfig, NotificationLevel } from "@yonder/bot-definition/notifications";
import type { NotificationStore } from "../store/state.js";

// Levels, the yaml block and its resolution are configuration facts and live at L0 in config/notifications.ts;
// only the persisted node preferences belong to the composition root. The old path keeps exporting both.
export {
	type NotificationConfig,
	type NotificationLevel,
	notificationLevel,
	notificationLevels,
} from "@yonder/bot-definition/notifications";

type CanonicalLevel = "all" | "mentions" | "mute";
const canonical = (level: NotificationLevel): CanonicalLevel => (level === "mention" ? "mentions" : level);
const prefix = "notification.pref:";

/** Node preferences persist separately from startup defaults. */
export async function createNotificationPrefs(store: NotificationStore, config: NotificationConfig | undefined) {
	const rows = await store.list();
	const runtime = new Map(
		rows.map(({ key, value }) => [key.slice(prefix.length), canonical(value as NotificationLevel)]),
	);
	const yaml = Object.fromEntries(
		Object.entries(config?.conversations ?? {}).map(([key, value]) => [key, canonical(value)]),
	);
	const initial = canonical(config?.default ?? "all");
	return {
		get() {
			const conversations = { ...yaml, ...Object.fromEntries([...runtime].filter(([key]) => key !== "*")) };
			return {
				default: runtime.get("*") ?? initial,
				conversations,
				sources: {
					default: runtime.has("*") ? "runtime" : "yaml",
					conversations: Object.fromEntries(
						Object.keys(conversations).map((key) => [key, runtime.has(key) ? "runtime" : "yaml"]),
					),
				},
			};
		},
		async set(conv: string, level: NotificationLevel | null) {
			if (level === null) {
				await store.set(prefix + conv, null);
				runtime.delete(conv);
			} else {
				const value = canonical(level);
				await store.set(prefix + conv, value);
				runtime.set(conv, value);
			}
		},
		level(conv?: string, session?: string): CanonicalLevel {
			return (
				(session && runtime.get(session)) ||
				(conv && runtime.get(conv)) ||
				(session && yaml[session]) ||
				(conv && yaml[conv]) ||
				runtime.get("*") ||
				initial
			);
		},
	};
}
