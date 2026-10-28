import { EVENT_TYPES, validate } from "./protocol/index.js";

/** Only counts are retained: no rejected payload, error path, or conversation body. */
export const eventValidation = { rejected: 0, unknownCarrier: 0 };

/** contracts §15 carrier allowlist (主 Agent 裁定 10-28：未知 carrier 丢弃). */
const carriers: ReadonlySet<string> = new Set(EVENT_TYPES);

export function mapEvent(type: string, data: unknown): { type: string; data: unknown } | undefined {
	if (data !== null && typeof data === "object" && "type" in data && data.type === "event") {
		if (!("name" in data) || typeof data.name !== "string" || !("data" in data)) {
			eventValidation.rejected++;
			return;
		}
		if (!carriers.has(data.name)) {
			eventValidation.unknownCarrier++;
			return;
		}
		type = data.name;
		data = data.data;
	}
	if (!validate(type, data)) {
		eventValidation.rejected++;
		return;
	}
	return { type, data };
}
