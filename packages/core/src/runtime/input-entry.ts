import type { JsonObject } from "@earendil-works/pi-durable";
import type { RuntimeInput } from "./types.js";

export function inputEntry(input: RuntimeInput) {
	return {
		kind: "yonder.message",
		data: JSON.parse(
			JSON.stringify({
				raw: true,
				event: input.event?.id,
				wake: input.wake ?? "run",
				attachments: input.attachments ?? [],
			}),
		) as JsonObject,
	};
}
