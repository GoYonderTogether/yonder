import type { PluginAPI, SocialPolicy, YEvent } from "@yonder/sdk";
import { groupEvents } from "./group-history.js";
import { ruleMatch } from "./group-rules.js";

const ATTENTION_MS = 300000;
const escapeName = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
interface MessageData {
	text?: string;
	msgId?: string;
	respondTo?: string;
	replyTo?: string;
	sourceMessageId?: string;
	sourceEvents?: string[];
	senderIsBot?: boolean;
	mentions?: string[];
	mentioned?: boolean;
	social?: { mentions?: { bot?: boolean } };
	delivery?: { ok?: boolean };
	qq?: { msgIdx?: string; refMsgIdx?: string };
}

/** Successful public replies provide the clock and recipient; incoming text cannot extend attention. */
export class GroupAttention {
	private readonly focus = new Map<string, Map<string, number>>();
	private names: Array<{ id: string; names: string[] }> = [];
	constructor(private readonly api: PluginAPI) {}
	async start() {
		this.names = (await this.api.agents.list()).map((a) => ({
			id: a.id,
			names: [...new Set([a.id, a.name, a.name.match(/^[A-Za-z][A-Za-z0-9_-]{2,}/)?.[0]].filter(Boolean))] as string[],
		}));
	}
	private async referenced(event: YEvent, ref: string, qqIndex = false) {
		const exact = qqIndex ? undefined : (await this.api.events.query({ id: ref })).events[0];
		if (exact?.conv === event.conv) return exact;
		for (const type of ["message.in", "message.out"])
			for await (const e of groupEvents(this.api, type, event.conv)) {
				const d = e.data as MessageData;
				if ((qqIndex ? d.qq?.msgIdx : (d.msgId ?? (e.data as { delivery?: { id?: string } }).delivery?.id)) === ref)
					return e;
			}
	}
	async elsewhere(event: YEvent, agent: string) {
		const d = event.data as MessageData;
		if (d.social?.mentions?.bot ?? d.mentioned) return false;
		if (d.mentions?.length) return true;
		const ref = d.replyTo ?? d.qq?.refMsgIdx;
		if (ref) {
			const target = await this.referenced(event, ref, !d.replyTo);
			if (target) return target.from !== `agent:${agent}`;
		}
		// Only an explicit salutation uses known identities; a name elsewhere in a sentence is not an address.
		const text = (d.text ?? "").trim().replace(/^(?:请|麻烦|让|给)\s*/, "");
		const aliases = this.names.flatMap((a) => a.names).sort((a, b) => b.length - a.length);
		const escaped = aliases.map(escapeName).join("|");
		if (!escaped) return false;
		const name = `@?(?:${escaped})`;
		const salutation = text.match(
			new RegExp(`^${name}(?:\\s*(?:和|与|及|、|,)\\s*${name})*(?=$|[\\s，,:：]|请|帮|把|来|做|处理|安排|你)`, "u"),
		)?.[0];
		if (!salutation) return false;
		return !this.names
			.find((a) => a.id === agent)
			?.names.some((n) =>
				new RegExp(`(?:^|(?:和|与|及|、|,)\\s*)@?${escapeName(n)}(?=$|\\s*(?:和|与|及|、|,))`, "u").test(salutation),
			);
	}
	async replied(event: YEvent, room: string) {
		const d = event.data as MessageData;
		if (!event.from?.startsWith("agent:") || !d.delivery?.ok || Date.now() >= Date.parse(event.ts) + ATTENTION_MS)
			return;
		let source: YEvent | undefined;
		const ref = d.respondTo ?? d.replyTo ?? d.sourceMessageId;
		if (ref) source = await this.referenced(event, ref);
		else if (event.parent) source = (await this.api.events.query({ id: event.parent })).events[0];
		const ids = (source?.data as MessageData | undefined)?.sourceEvents;
		if (ids?.length) source = (await this.api.events.query({ id: ids.at(-1)! })).events[0];
		if (
			source?.type !== "message.in" ||
			source.conv !== event.conv ||
			!source.from?.startsWith("acct:") ||
			(source.data as MessageData).senderIsBot
		)
			return;
		const key = `${event.from}\0${room}`;
		const members = this.focus.get(key) ?? new Map<string, number>();
		members.set(source.from, Math.max(members.get(source.from) ?? 0, Date.parse(event.ts) + ATTENTION_MS));
		this.focus.set(key, members);
	}
	async consider(
		c: { agent: string; counter: number; lastSent?: number; pause?: { scope: string; actor?: string } },
		room: string,
		entries: YEvent[],
		policy: SocialPolicy,
		controls: Set<string>,
	) {
		let matched = false,
			focused = false,
			errors = 0,
			eligible = 0;
		const relevant: YEvent[] = [];
		for (const event of entries) {
			if (controls.has(event.id) || (await this.elsewhere(event, c.agent))) continue;
			const result = ruleMatch((event.data as MessageData).text ?? "", policy, () => errors++);
			if (!result.eligible) continue;
			if (c.pause?.scope === "group" || c.pause?.actor === event.from) continue;
			relevant.push(event);
			c.counter++;
			eligible++;
			focused ||= (this.focus.get(`agent:${c.agent}\0${room}`)?.get(event.from ?? "") ?? 0) > Date.now();
			matched ||= result.match;
		}
		matched ||= focused || (eligible > 0 && c.counter >= (policy.batch?.count ?? 20));
		if (
			c.pause?.scope === "group" ||
			(!focused && Date.now() < (c.lastSent ?? 0) + (policy.minIntervalSeconds ?? 60) * 1000)
		)
			matched = false;
		if (matched) c.counter = 0;
		return { matched, focused, errors, relevant };
	}
}
