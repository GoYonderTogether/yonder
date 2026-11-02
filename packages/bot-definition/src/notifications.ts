/** `yonder.yaml` notifications block: levels, the default and per-conversation overrides (08). */
export const notificationLevels = ["all", "mention", "mentions", "mute"] as const;
export type NotificationLevel = (typeof notificationLevels)[number];

export interface NotificationConfig {
	default?: NotificationLevel;
	conversations?: Record<string, NotificationLevel>;
}

/** The level a conversation inherits: its own override, else the configured default, else `all`. */
export function notificationLevel(config: NotificationConfig | undefined, conv?: string): NotificationLevel {
	return (conv ? config?.conversations?.[conv] : undefined) ?? config?.default ?? "all";
}
