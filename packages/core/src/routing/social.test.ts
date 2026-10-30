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
	expect(socialDecision(configured as unknown as typeof agent, event, undefined)?.reason).toBe("owner-mention");
	expect(
		socialDecision(configured as unknown as typeof agent, { ...event, conv: "conv:chat:other" }, undefined)?.reason,
	).toBe("not-authorized");
});

test("an @all legacy mention is not a bot mention under social policy", () => {
	const event = message("group", "acct:chat:user", "conv:chat:group", {
		mentioned: true,
		social: { mentions: { bot: false, everyone: true } },
	});
	expect(socialDecision(agent, event, undefined)).toMatchObject({ reason: "batch", run: false });
	const respond = {
		...agent,
		social: { ...agent.social, defaults: { group: { signals: { everyone: "respond" as const } } } },
	};
	expect(socialDecision(respond as unknown as typeof agent, event, undefined)).toMatchObject({
		reason: "everyone",
		run: true,
	});
});

test("conversation batch and signal settings retain unspecified group defaults", () => {
	const configured = {
		...agent,
		social: {
			...agent.social,
			defaults: { group: { batch: { run: true, delaySeconds: 60 }, signals: { everyone: "respond" as const } } },
			conversations: { "conv:chat:group": { batch: { count: 5 }, signals: { keyword: "record" as const } } },
		},
	};
	const decision = socialDecision(configured as unknown as typeof agent, message("group"), undefined);
	expect(decision && "policy" in decision && decision.policy.batch).toEqual({ run: true, delaySeconds: 60, count: 5 });
	const everyone = message("group", "acct:chat:user", "conv:chat:group", { social: { mentions: { everyone: true } } });
	expect(socialDecision(configured as unknown as typeof agent, everyone, undefined)?.reason).toBe("everyone");
});

test("scoped group social leaves private and other-group routing unchanged", () => {
	const scoped = { ...agent, social: { ...agent.social, scope: ["conv:chat:group"] } } as typeof agent;
	expect(socialDecision(scoped, message("dm", "acct:chat:user", "conv:chat:private"), undefined)).toBeUndefined();
	expect(socialDecision(scoped, message("group", "acct:chat:user", "conv:chat:other"), undefined)).toBeUndefined();
	expect(
		socialBindingAllowed(scoped, message("dm", "acct:chat:user", "conv:chat:private"), undefined, {
			id: "dm",
			match: {},
			session: "main",
		}),
	).toBe(true);
	expect(
		socialDecision(
			scoped,
			message("group", "acct:chat:user", "conv:chat:group", { senderIsBot: true, mentioned: true }),
			undefined,
		),
	).toMatchObject({ reason: "record", run: false });
});
