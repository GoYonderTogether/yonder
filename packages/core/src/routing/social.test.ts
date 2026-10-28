import { expect, test } from "vitest";
import { parseAgentConfig } from "../config/index.js";
import { socialBindingAllowed, socialDecision } from "./social.js";

const agent = parseAgentConfig(
	JSON.stringify({
		schema: 1,
		id: "main",
		name: "main",
		owner: "person:owner",
		defaultProfile: "guest",
		profiles: { guest: {} },
		bindings: [],
		social: { enabled: true, authorized: { conversations: ["conv:chat:group"] }, denied: ["acct:chat:blocked"] },
	}),
);
const message = (kind: string, from = "acct:chat:user", conv = "conv:chat:group", data = {}) => ({
	id: "e",
	ts: "2026-01-01T00:00:00Z",
	type: "message.in",
	from,
	conv,
	data: { kind, ...data },
});

test("social scopes authorize independently and fail closed", () => {
	expect(socialDecision(agent, message("dm", "acct:chat:owner", "conv:chat:owner"), "person:owner")?.run).toBe(true);
	expect(socialDecision(agent, message("dm", "acct:chat:user", "conv:chat:private"), undefined)?.run).toBe(false);
	expect(
		socialDecision(agent, message("group", "acct:chat:blocked", "conv:chat:group", { mentioned: true }), undefined)
			?.reason,
	).toBe("denied");
	expect(
		socialDecision(agent, message("group", "acct:chat:user", "conv:chat:group", { text: "@bot" }), undefined)?.run,
	).toBe(false);
	expect(
		socialDecision(agent, message("group", "acct:chat:user", "conv:chat:group", { mentioned: true }), undefined)?.run,
	).toBe(true);
	expect(
		socialDecision(
			agent,
			message("group", "acct:chat:user", "conv:chat:group", { mentioned: true, social: { mentions: { bot: false } } }),
			undefined,
		)?.reason,
	).toBe("mention-conflict");
	expect(socialDecision(agent, message("unknown"), "person:owner")?.run).toBe(false);
	expect(socialBindingAllowed(agent, message("group"), "person:owner", { id: "x", match: {}, session: "main" })).toBe(
		false,
	);
});

test("owner mentions respect the configured signal without granting authorization", () => {
	const configured = {
		...agent,
		social: {
			...agent.social!,
			defaults: { group: { mode: "mention" as const, signals: { ownerMention: "respond" as const } } },
		},
	};
	const event = message("group", "acct:chat:user", "conv:chat:group", { social: { mentions: { owner: true } } });
	expect(socialDecision(configured, event, undefined)?.reason).toBe("owner-mention");
	expect(socialDecision(configured, { ...event, conv: "conv:chat:other" }, undefined)?.reason).toBe("not-authorized");
});
