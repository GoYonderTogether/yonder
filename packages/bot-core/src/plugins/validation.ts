import type { EventInput, TSchema } from "@yonder/sdk";
import { Errors } from "typebox/value";

export function pluginEvent(id: string, event: EventInput, channel?: string, multiAgent = false): EventInput {
	if (
		["routing.social-decision", "notification.intent", "notification.final", "channel.connected"].includes(event.type)
	)
		throw new Error(`${id}: ${event.type} is a core event`);
	if (event.type === "message.in" && channel) {
		if (
			!event.from?.startsWith(`acct:${channel}:`) ||
			!event.conv?.startsWith(`conv:${channel}:`) ||
			("target" in event.data && !multiAgent)
		)
			throw new Error(`${id}: message.in must use its own channel and cannot specify target`);
	} else if (!event.type.startsWith(`${id}.`) || event.type.length === id.length + 1)
		throw new Error(`${id}: event type must start with ${id}.`);
	return event;
}

export function validateConfig(pluginId: string, label: string, schema: TSchema, value: unknown): void {
	const errors = [...Errors(schema, value)].map((error) => `${error.instancePath || "/"}: ${error.message}`);
	if (errors.length) throw new Error(`${pluginId}: invalid ${label}: ${errors.join("; ")}`);
}

export function instanceConfig(value: { type: string } & Record<string, unknown>): Record<string, unknown> {
	const { type: _, ...config } = value;
	return config;
}
