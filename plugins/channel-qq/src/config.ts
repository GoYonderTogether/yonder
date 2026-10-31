import type { TSchema } from "@yonder/sdk";

export interface Config {
	appId: string;
	credential: string;
	allowedUsers?: string[];
	allowedGroups?: string[];
	groupWindowSeconds?: number;
	groupParticipation?: Record<string, "all" | "mention" | "record">;
	groupKeywords?: string[];
	sendIntervalMs?: number;
	localMediaRoot?: string;
}
const str = { type: "string", minLength: 1 };
export const configSchema = {
	type: "object",
	additionalProperties: false,
	required: ["appId", "credential"],
	properties: {
		appId: { type: "string", pattern: "^[0-9]+$" },
		credential: str,
		allowedUsers: { type: "array", items: str },
		allowedGroups: { type: "array", items: str },
		groupWindowSeconds: { type: "integer", minimum: 1, maximum: 3600 },
		groupParticipation: {
			type: "object",
			description: "Per-group participation override; unconfigured groups default to all.",
			additionalProperties: { enum: ["all", "mention", "record"] },
		},
		groupKeywords: { type: "array", items: str },
		sendIntervalMs: { type: "integer", minimum: 0, maximum: 60000 },
		localMediaRoot: { type: "string", minLength: 1 },
	},
} as TSchema;
