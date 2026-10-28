import type { YEvent } from "@yonder/sdk";
import { inboundNotification, type NotificationConfig, type NotificationLevel } from "../kernel/notifications.js";
import type { Runtime } from "../runtime/index.js";
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
