import type { SessionInfo, YEvent } from "@yonder/sdk";
import type { ProgramSourceFrame } from "../runtime/types.js";
import type { Store } from "../store/index.js";
import { parentSources, requestSources } from "../tools/parent-origin.js";

const SOURCE_LIMIT = 8;
const TEXT_LIMIT = 2000;
const MENTION_LIMIT = 16;
const PROGRAM_SOURCE_LIMIT = 8;

/** A program input is contextual only after its current session and parent chain are verified. */
export async function programSourceFrame(
	store: Store,
	sessionId: string | undefined,
	event: YEvent,
): Promise<ProgramSourceFrame | undefined> {
	const role =
		event.type === "runtime.tool-result"
			? "program-result"
			: event.type === "runtime.continuation"
				? "continuation"
				: undefined;
	if (!role) return;
	const unknown = (reason: string): ProgramSourceFrame => ({
		role,
		sources: { status: "unknown", limit: PROGRAM_SOURCE_LIMIT, reason },
	});
	try {
		const session = sessionId ? await store.sessions.get(sessionId) : undefined;
		const sources = session ? await requestSources(store, session, [event.id]) : undefined;
		if (!sources?.length) return unknown("current session source chain could not be verified");
		const items = sources
			.slice(0, PROGRAM_SOURCE_LIMIT)
			.flatMap((source) => (source.conv ? [{ id: source.id, conv: source.conv }] : []));
		if (items.length !== Math.min(sources.length, PROGRAM_SOURCE_LIMIT))
			return unknown("verified source conversation unavailable");
		return {
			role,
			sources: {
				status: "verified",
				limit: PROGRAM_SOURCE_LIMIT,
				total: sources.length,
				omitted: Math.max(0, sources.length - PROGRAM_SOURCE_LIMIT),
				items,
			},
		};
	} catch {
		return unknown("source verification unavailable");
	}
}

export type VerifiedBatchSourceFrame = {
	status: "verified";
	agent: string;
	conv: string;
	session: string;
	plugin: string;
	through: string;
	limit: number;
	truncated: boolean;
	omitted: number;
	sources: Array<{
		id: string;
		conv: string;
		agent: string;
		session: string;
		at: string;
		from: string;
		relation: "owner" | "known" | "stranger";
		route: { binding?: string; wake: "write" };
		kind?: string;
		text?: string;
		textLength: number;
		textOmitted: boolean;
		mentions?: string[];
		mentionsTruncated?: boolean;
		mentioned?: boolean;
		replyTo?: string;
		replyToTruncated?: boolean;
		quote?: { text?: string; textLength: number; omitted: boolean };
		social?: {
			mentions?: { bot?: boolean; owner?: boolean; everyone?: boolean; accounts?: string[]; truncated?: boolean };
			senderRole?: string;
			nativeKind?: string;
		};
	}>;
};

/** Reconstruct the bounded, current source set only after the batch was routed to this session. */
export async function batchSourceFrame(
	store: Store,
	session: SessionInfo,
	event: YEvent,
): Promise<VerifiedBatchSourceFrame | undefined> {
	const suffix = ".batch-ready";
	const agent = session.agent;
	if (
		!agent ||
		session.mode !== "persistent" ||
		!event.type.endsWith(suffix) ||
		!event.conv ||
		session.key !== event.conv
	)
		return;
	const plugin = event.type.slice(0, -suffix.length);
	const data = event.data as { agent?: unknown; through?: unknown; sourceEvents?: unknown };
	const ids = data.sourceEvents;
	if (
		!plugin ||
		event.from !== `plugin:${plugin}` ||
		data.agent !== agent ||
		typeof data.through !== "string" ||
		!Array.isArray(ids) ||
		ids.length < 1 ||
		ids.length > 100 ||
		ids.at(-1) !== data.through ||
		ids.some((id, index) => {
			const previous = ids[index - 1];
			return typeof id !== "string" || (index > 0 && typeof previous === "string" && previous >= id);
		}) ||
		!event.routes?.some(
			(route) => route.agent === agent && route.session === session.id && route.wake === "run" && !route.dropped,
		)
	)
		return;
	const events = await parentSources(store, session, [event.id]);
	if (!events || events.length !== ids.length || events.some((source, index) => source.id !== ids[index])) return;
	if (
		events.some(
			(source) =>
				!source.routes?.some(
					(route) => route.agent === agent && route.session === session.id && route.wake === "write" && !route.dropped,
				),
		)
	)
		return;
	const selected = events.slice(-SOURCE_LIMIT);
	const sources = await Promise.all(
		selected.map(async (source) => {
			if (!source.from || !source.conv) return undefined;
			const relation = await store.identity().relation(agent, source.from);
			const sourceRoute = source.routes?.find(
				(route) => route.agent === agent && route.session === session.id && route.wake === "write" && !route.dropped,
			);
			if (!sourceRoute) return undefined;
			const data = source.data as Record<string, unknown>;
			const text = typeof data.text === "string" ? data.text : "";
			const mentions = Array.isArray(data.mentions)
				? data.mentions.filter((item): item is string => typeof item === "string")
				: undefined;
			const social = data.social as
				| {
						mentions?: { bot?: boolean; owner?: boolean; everyone?: boolean; accounts?: unknown };
						senderRole?: string;
						nativeKind?: string;
				  }
				| undefined;
			const socialMentions = social?.mentions;
			const quote = data.quote as { text?: unknown } | undefined;
			const quoteText = typeof quote?.text === "string" ? quote.text : undefined;
			return {
				id: source.id,
				conv: source.conv,
				agent,
				session: session.id,
				at: source.ts,
				from: source.from,
				relation,
				route: { ...(sourceRoute.binding ? { binding: sourceRoute.binding } : {}), wake: "write" as const },
				...(typeof data.kind === "string" ? { kind: data.kind } : {}),
				...(text.length <= TEXT_LIMIT ? { text } : {}),
				textLength: text.length,
				textOmitted: text.length > TEXT_LIMIT,
				...(mentions
					? {
							mentions: mentions.slice(0, MENTION_LIMIT),
							...(mentions.length > MENTION_LIMIT ? { mentionsTruncated: true } : {}),
						}
					: {}),
				...(typeof data.mentioned === "boolean" ? { mentioned: data.mentioned } : {}),
				...(typeof data.replyTo === "string"
					? { replyTo: data.replyTo.slice(0, 512), ...(data.replyTo.length > 512 ? { replyToTruncated: true } : {}) }
					: {}),
				...(quoteText !== undefined
					? {
							quote: {
								...(quoteText.length <= TEXT_LIMIT ? { text: quoteText } : {}),
								textLength: quoteText.length,
								omitted: quoteText.length > TEXT_LIMIT,
							},
						}
					: {}),
				...(social
					? {
							social: {
								...(socialMentions
									? {
											mentions: {
												...(typeof socialMentions.bot === "boolean" ? { bot: socialMentions.bot } : {}),
												...(typeof socialMentions.owner === "boolean" ? { owner: socialMentions.owner } : {}),
												...(typeof socialMentions.everyone === "boolean" ? { everyone: socialMentions.everyone } : {}),
												...(Array.isArray(socialMentions.accounts)
													? {
															accounts: socialMentions.accounts
																.filter((account): account is string => typeof account === "string")
																.slice(0, MENTION_LIMIT),
															...(socialMentions.accounts.length > MENTION_LIMIT ? { truncated: true } : {}),
														}
													: {}),
											},
										}
									: {}),
								...(typeof social.senderRole === "string" ? { senderRole: social.senderRole } : {}),
								...(typeof social.nativeKind === "string" ? { nativeKind: social.nativeKind } : {}),
							},
						}
					: {}),
			};
		}),
	);
	if (sources.some((source) => !source)) return;
	return {
		status: "verified",
		agent,
		conv: event.conv,
		session: session.id,
		plugin,
		through: data.through,
		limit: SOURCE_LIMIT,
		truncated: events.length > SOURCE_LIMIT,
		omitted: Math.max(0, events.length - SOURCE_LIMIT),
		sources: sources as VerifiedBatchSourceFrame["sources"],
	};
}
