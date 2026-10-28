import type { YEvent } from "@yonder/sdk";

export const notificationLevels = ["all", "mention", "mute"] as const;
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
	if (level === "mention" && data.mentioned !== true) return;
	const text = body(event);
	if (!text) return;
	return { from: event.from ?? "system:yonder", event: event.id, text: truncate(text) };
}
