import type { Tool } from "@yonder/sdk";
import { Type } from "typebox";

const id = Type.String({ pattern: "^[a-z0-9][a-z0-9-]{0,47}$" });
const words = Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { maxItems: 32 });
const rules = Type.Object(
	{ keywords: { ...words, minItems: 1 }, exclude: Type.Optional(words) },
	{ additionalProperties: false },
);
const version = Type.Integer({ minimum: 1 });
const reason = Type.String({ minLength: 1, maxLength: 2000, pattern: "\\S" });
export function registerWatchTools(
	register: (name: string, description: string, parameters: Tool["parameters"], write?: boolean) => void,
) {
	register(
		"watch_configure",
		"Create a read-only subscription for this Bot from an authorized WeChat source. Requires an existing private profile and the Bot owner's private account plus explicit channel instance. Validates routing before enabling; starts after the latest real archived message. Never replies in WeChat groups.",
		Type.Object(
			{
				id,
				chat: Type.String({ pattern: "^Msg_[a-fA-F0-9]+$" }),
				profile: Type.String({ minLength: 1 }),
				purpose: reason,
				rules,
				notification: Type.Object(
					{ to: Type.String({ minLength: 1 }), via: Type.String({ minLength: 1 }) },
					{ additionalProperties: false },
				),
				reason,
			},
			{ additionalProperties: false },
		),
		true,
	);
	register(
		"watch_inspect",
		"Inspect this Bot's subscriptions, rule history, source freshness, routing, accepted batches, run.end and actual reminder Delivery. Acquisition is not model processing; delivered is not read.",
		Type.Object({ id: Type.Optional(id) }, { additionalProperties: false }),
	);
	register(
		"watch_control",
		"Pause/delete stops only new wakes for this subscription, not runs already accepted. Resume requires from=paused (saved cursor, include accumulated messages) or now (skip backlog). Rules/rollback require version and reason, and never alter permissions, destination or cursor.",
		Type.Object(
			{
				id,
				op: Type.Union(["pause", "resume", "delete", "rules", "rollback"].map((v) => Type.Literal(v))),
				expectedVersion: version,
				from: Type.Optional(Type.Union([Type.Literal("paused"), Type.Literal("now")])),
				rules: Type.Optional(rules),
				version: Type.Optional(version),
				reason,
			},
			{ additionalProperties: false },
		),
		true,
	);
	register(
		"watch_test",
		"Replay a bounded recent local archive sample against current rules. Does not sync, wake, send or advance any cursor. A match is not evidence of a delivered reminder.",
		Type.Object(
			{ id, limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) },
			{ additionalProperties: false },
		),
	);
}
