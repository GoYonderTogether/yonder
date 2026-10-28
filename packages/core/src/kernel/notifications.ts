import type { YEvent } from "@yonder/sdk";
import type { Db } from "../runtime/db.js";

export const notificationLevels = ["all", "mention", "mentions", "mute"] as const;
export type NotificationLevel = (typeof notificationLevels)[number];

/** `yonder.yaml` notifications block: one default plus per-conversation overrides. */
export interface NotificationConfig {
	default?: NotificationLevel;
	conversations?: Record<string, NotificationLevel>;
}

/** Notification body limit, counted in code points so surrogate pairs are never split. */
const bodyLimit = 120;
const truncate = (text: string): string => Array.from(text).slice(0, bodyLimit).join("");

export function notificationLevel(config: NotificationConfig | undefined, conv?: string): NotificationLevel {
	return (conv ? config?.conversations?.[conv] : undefined) ?? config?.default ?? "all";
}

function body(event: YEvent): string {
	const data = event.data as { text?: unknown; summary?: unknown; attachments?: unknown };
	if (typeof data.text === "string" && data.text.trim()) return data.text.trim();
	if (typeof data.summary === "string" && data.summary.trim()) return data.summary.trim();
	if (Array.isArray(data.attachments) && data.attachments.length) return `[${data.attachments.length} 个附件]`;
	return "";
}

/**
 * Notification record for one routed session, or undefined when the conversation
 * level suppresses it. Only `message.in` and events opting in with a string
 * `data.summary` produce notifications; everything else is recorded without one.
 */
export function inboundNotification(
	config: NotificationConfig | undefined,
	event: YEvent,
): { from: string; event: string; text: string } | undefined {
	const data = event.data as { mentioned?: unknown; summary?: unknown };
	if (event.type !== "message.in" && typeof data.summary !== "string") return;
	const level = notificationLevel(config, event.conv);
	if (level === "mute") return;
	if ((level === "mention" || level === "mentions") && data.mentioned !== true) return;
	const text = body(event);
	if (!text) return;
	return { from: event.from ?? "system:yonder", event: event.id, text: truncate(text) };
}

type CanonicalLevel = "all" | "mentions" | "mute";
const canonical = (level: NotificationLevel): CanonicalLevel => (level === "mention" ? "mentions" : level);
const prefix = "notification.pref:";

/** Node preferences persist separately from startup defaults. */
export async function createNotificationPrefs(db: Db, config: NotificationConfig | undefined) {
	const rows = await db.all<{ key: string; value: string }>(
		"SELECT key, value FROM y_meta WHERE key LIKE ?",
		`${prefix}%`,
	);
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
				await db.run("DELETE FROM y_meta WHERE key = ?", prefix + conv);
				runtime.delete(conv);
			} else {
				const value = canonical(level);
				await db.run("INSERT OR REPLACE INTO y_meta(key, value) VALUES (?, ?)", prefix + conv, value);
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
