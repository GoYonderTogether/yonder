import {
	notificationLevel as levelOf,
	type NotificationConfig,
	type NotificationLevel,
} from "@yonder/bot-definition/notifications";
import type { Runtime } from "@yonder/runtime-adapter/types";
import type { YEvent } from "@yonder/sdk";
import { channelOf } from "./matching.js";

type Notification = {
	id: number;
	from: string;
	event: string;
	text: string;
	session: string;
	conv?: string;
	channel?: string;
};

/** Notification body limit, counted in code points so surrogate pairs are never split. */
const bodyLimit = 120;
const truncate = (text: string): string => Array.from(text).slice(0, bodyLimit).join("");

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
	const level = levelOf(config, event.conv);
	if (level === "mute") return;
	if ((level === "mention" || level === "mentions") && data.mentioned !== true) return;
	const text = body(event);
	if (!text) return;
	return { from: event.from ?? "system:yonder", event: event.id, text: truncate(text) };
}

export function createRoutedNotifications(
	runtime: () => Runtime,
	report: (error: unknown) => void,
	notificationLevel?: (conv?: string, session?: string) => NotificationLevel,
	notifications?: NotificationConfig,
) {
	const listeners = new Set<(event: Notification) => void>();
	return {
		observe(listener: (event: Notification) => void) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		notify(session: string, event: YEvent) {
			const level = notificationLevel?.(event.conv, session);
			const notification = inboundNotification(level ? { default: level } : notifications, event);
			if (notification)
				return (async () => {
					try {
						const existed = await runtime().notificationRecorded(session, notification.from, notification.event);
						const receipt = await runtime().notify(session, notification);
						if (!existed)
							for (const listener of listeners)
								listener({
									id: receipt.entry,
									...notification,
									session,
									...(event.conv ? { conv: event.conv } : {}),
									...(channelOf(event.conv) ? { channel: channelOf(event.conv)! } : {}),
								});
					} catch (error) {
						report(error);
					}
				})();
		},
	};
}
