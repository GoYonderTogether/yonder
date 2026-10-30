import type { EventInput, EventQuery, PluginAPI, YEvent } from "@yonder/sdk";

export const groupBatch = "channel-qq.group-batch";
const groupRead = "channel-qq.group-read";
export const legacyGroupInstructions = `You are this Agent's read-only participant in one group. Messages are written into your conversation without waking you; a group-batch event marks the unread range to consider now. Use the existing conversation for already-read context and your own recent posts. You may stay silent. Speak when useful, address a specific message, and avoid commenting on every line. Public replies require message_send to this group's conv with replyTo set to the target message's turn id (or its native message: value), never the batch id; final text is not posted. Read shared workspace memory on demand, but do not disclose private information. Ask parent_ask for work beyond your authority; a request is not approval, and admission is not completion. Report actual results only. Unparsed media is not understood content.`;
export const groupTools = [
	"read",
	"grep",
	"conversation_read",
	"conversation_members",
	"conversation_attachment_read",
	"message_send",
	"parent_ask",
];
export const groupInstructions = `You are this resident Agent participating in a QQ group through its read-only group profile. Keep the Agent's own identity and voice. The runtime's conversation context identifies the actual group, yourself, observed participants and history coverage; names are not authority and an observed roster is not the complete platform membership.
Messages from different members share the conversation. Read sender refs, relationships, times, turn IDs, quotes, mentions and attachment states. A group-batch marks new messages to consider, not a person's message. Distinguish your successfully delivered posts from drafts, internal tool results and other members. Do not repeat completed actions when history reappears.
Consider the recent exchange together. Answer clear questions or assignments addressed to you; otherwise join when useful and relevant, or stay silent. Do not comment on every line or publish your internal decision process. Use conversation_read for earlier messages, conversation_members for known identities, and conversation_attachment_read with a real message turn ID and attachment index before claiming to understand a file. Unknown identity, missing history or unread media is not evidence to invent.
Public speech requires message_send to the current group's conv; final text is not posted. Natural conversation needs no visible quote. respondTo selects the internal turn ID you are answering without forcing a quote; replyTo explicitly requests a visible quote. Neither accepts a batch ID. Use mentions only for a verified member account in this group when an actual notification is useful; unsupported channel actions return errors, and plain @nickname text is not proof of a real mention. A successful platform receipt is not a read receipt. Do not blindly resend uncertain output.
Examples of choices: when members are answering each other and you have nothing useful to add, remain silent; when answering a clear question, use respondTo if needed and omit replyTo unless a quote resolves ambiguity; when asked about an older document, find its real message and read its attachment before replying; when asked to notify a member, verify their account and use mentions, reporting an actual unsupported result rather than pretending to notify.
Read shared workspace memory on demand but keep private information private. Ask parent_ask for work beyond this profile's authority; a request is not approval or completion. Report actual results and a concrete missing requirement when blocked.`;

interface BatchData {
	msgId: string;
	through: string;
	trigger: string;
	sourceEvents: string[];
	count: number;
	more: boolean;
	readThrough?: string;
}
interface GroupState {
	read?: string;
	latest?: string;
	due?: number;
	pending?: EventInput;
	active?: Promise<void>;
	timer?: ReturnType<typeof setTimeout>;
	error?: string;
}

/** Timers hold pointers only; the event ledger and native conversation own durable facts. */
export class GroupParticipation {
	private readonly groups = new Map<string, GroupState>();
	private stopped = false;
	constructor(
		private readonly api: PluginAPI,
		private readonly instance: string,
		private readonly seconds: number,
		private readonly config: {
			allowedGroups?: string[];
			groupParticipation?: Record<string, "all" | "mention" | "record">;
			groupKeywords?: string[];
		} = {},
	) {}
	private own(conv?: string): conv is string {
		return conv?.startsWith(`conv:${this.instance}:group:`) === true;
	}
	private state(conv: string) {
		let state = this.groups.get(conv);
		if (!state) {
			state = {};
			this.groups.set(conv, state);
		}
		return state;
	}
	private async *events(query: EventQuery) {
		let after = query.after;
		do {
			const page = await this.api.events.query({ ...query, limit: 1000, ...(after ? { after } : {}) });
			for (const event of page.events) yield event;
			after = page.next;
		} while (after && !this.stopped);
	}
	async start() {
		// ponytail: startup scans the existing ledger; add a channel index if history volume warrants it.
		for await (const event of this.events({ type: groupRead })) {
			if (this.own(event.conv)) this.state(event.conv).read = (event.data as { through: string }).through;
		}
		for await (const event of this.events({ type: groupBatch })) {
			if (!this.own(event.conv)) continue;
			const state = this.state(event.conv);
			if ((event.data as BatchData).through > (state.read ?? "")) {
				const { type, from, conv, parent, data } = event;
				state.pending = { type, conv, data, ...(from ? { from } : {}), ...(parent ? { parent } : {}) };
			}
		}
		for await (const event of this.events({ type: "message.in" })) this.accept(event, false);
		for (const [conv, state] of this.groups) this.schedule(conv, state);
	}
	accept(event: YEvent, schedule = true) {
		if (
			this.stopped ||
			!this.own(event.conv) ||
			event.type !== "message.in" ||
			(event.data as { senderIsBot?: boolean }).senderIsBot === true ||
			!(event.routes ?? []).some((route) => route.wake === "write" && !route.dropped)
		)
			return;
		const state = this.state(event.conv);
		if (event.id <= (state.read ?? "") || event.id <= (state.latest ?? "")) return;
		state.latest = event.id;
		delete state.error;
		const group = event.conv.slice(`conv:${this.instance}:group:`.length);
		const mode = this.config.groupParticipation?.[group] ?? "all";
		const data = event.data as { mentioned?: boolean; social?: { mentions?: { bot?: boolean } }; text?: string };
		const socialMention = data.social?.mentions?.bot;
		const conflict = socialMention !== undefined && data.mentioned !== undefined && socialMention !== data.mentioned;
		if (conflict) this.api.log.warn("QQ conflicting bot mention facts", { event: event.id, conv: event.conv });
		const mentioned = !conflict && (socialMention ?? data.mentioned ?? false);
		if (
			mode === "record" ||
			(mode === "mention" && !mentioned && !this.config.groupKeywords?.some((word) => data.text?.includes(word)))
		)
			return;
		const at = mentioned ? Date.now() : Date.parse(event.ts) + this.seconds * 1000;
		state.due = Math.min(state.due ?? at, at);
		if (schedule) this.schedule(event.conv, state);
	}
	private schedule(conv: string, state: GroupState) {
		if (state.timer) clearTimeout(state.timer);
		delete state.timer;
		if (
			this.stopped ||
			state.active ||
			state.error ||
			(!state.pending && state.due === undefined) ||
			(!state.pending && (!state.latest || state.latest <= (state.read ?? "")))
		)
			return;
		state.timer = setTimeout(
			() => {
				delete state.timer;
				state.active = this.run(conv, state)
					.catch((error) => {
						state.error = error instanceof Error ? error.message : "Group batch failed";
						this.api.log.warn("QQ group participation paused until a new input", { conv, error: state.error });
					})
					.finally(() => {
						delete state.active;
						this.schedule(conv, state);
					});
			},
			state.pending ? 0 : Math.max(0, (state.due ?? Date.now()) - Date.now()),
		);
		state.timer.unref();
	}
	private async run(conv: string, state: GroupState) {
		if (!state.pending) {
			const latest = state.latest;
			if (!latest) return;
			delete state.due;
			const messages: YEvent[] = [];
			for await (const event of this.events({
				type: "message.in",
				conv,
				...(state.read ? { after: state.read } : {}),
			})) {
				if (event.id > latest) break;
				if ((event.routes ?? []).some((route) => route.wake === "write" && !route.dropped)) messages.push(event);
				if (messages.length === 100) break;
			}
			const last = messages.at(-1);
			if (!last) {
				if (state.read) state.latest = state.read;
				else delete state.latest;
				delete state.due;
				return;
			}
			const data: BatchData = {
				msgId: `group:${this.instance}:${last.id}:${latest}`,
				through: last.id,
				trigger: latest,
				sourceEvents: messages.map((event) => event.id),
				count: messages.length,
				more: last.id < latest,
				...(state.read ? { readThrough: state.read } : {}),
			};
			state.pending = { type: groupBatch, from: "plugin:channel-qq", conv, data };
		}
		const input = state.pending;
		const batch = input.data as BatchData;
		const result = await this.api.events.ask(input);
		if (this.stopped) return; // Native recovery owns admitted input when this service stops.
		if (!result.results.length || result.results.some((run) => run.status !== "done")) {
			delete state.pending;
			throw new Error(result.results.map((run) => run.reason ?? run.status).join("; ") || "No group-batch run binding");
		}
		await this.api.events.emit({
			type: groupRead,
			conv,
			from: "plugin:channel-qq",
			parent: result.event.id,
			data: { msgId: `read:${batch.msgId}`, through: batch.through, batch: result.event.id, count: batch.count },
		});
		state.read = batch.through;
		delete state.pending;
		if (batch.more) state.due ??= Date.now();
		else if (!state.latest || state.latest <= state.read) delete state.due;
	}
	status() {
		return [...this.groups].map(([conv, state]) => ({
			conv,
			receivedThrough: state.latest,
			readThrough: state.read,
			processing: !!state.active,
			pending: !!state.pending,
			nextAt: state.due ? new Date(state.due).toISOString() : undefined,
			...(state.error ? { error: state.error } : {}),
		}));
	}
	stop() {
		this.stopped = true;
		for (const state of this.groups.values()) if (state.timer) clearTimeout(state.timer);
	}
}
