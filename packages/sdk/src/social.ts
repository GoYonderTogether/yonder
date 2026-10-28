import type { Ref, ToolContext } from "./types.js";
export type Participation = "direct" | "record" | "mention" | "batch" | "folded" | "mute";
export type SocialSignal = "botMention" | "ownerMention" | "groupOwner" | "everyone" | "keyword";
export interface SocialPolicy {
	mode?: Participation;
	batch?: { count?: number; delaySeconds?: number; maxMessages?: number; maxBytes?: number; run?: boolean };
	minIntervalSeconds?: number;
	signals?: Partial<Record<SocialSignal, "record" | "consider" | "respond">>;
	keywords?: string[];
	quiet?: { timezone: string; start: string; end: string };
	foldedEverySeconds?: number;
	judge?: { preset: string; maxCallsPerHour?: number };
}
export interface SocialConfig {
	enabled?: boolean;
	authorized?: { people?: Ref[]; accounts?: Ref[]; conversations?: Ref[] };
	friends?: Ref[];
	denied?: Ref[];
	defaults?: { dm?: SocialPolicy; group?: SocialPolicy; channel?: SocialPolicy };
	conversations?: Record<Ref, SocialPolicy>;
	mappings?: Array<{ subject: Ref; agent: string; profile: string }>;
}
export interface SocialMessageData {
	mentions?: { bot?: boolean; owner?: boolean; everyone?: boolean; accounts?: Ref[] };
	senderRole?: "group-owner" | "member" | "unknown";
	parentConv?: Ref;
	nativeKind?: string;
}
export interface ChannelFeatures {
	identity?: "account" | "person-link" | "unknown";
	mentions?: Array<"bot" | "owner" | "everyone" | "accounts">;
	quote?: "none" | "id" | "content";
	edit?: boolean;
	retract?: boolean;
	streamMode?: "none" | "message" | "token";
	rateLimit?: { scope: "instance" | "conv"; max: number; windowSeconds: number };
	history?: "none" | "recent" | "cursor";
}
export interface NotificationIntent {
	kind: "progress" | "decision" | "digest" | "failure";
	key: string;
	sourceEvents: string[];
	expiresAt?: string;
}

export interface SocialAPI {
	/** Recheck a pending batch against current routing and policy without admitting it. */
	admitBatch(request: {
		agent: string;
		conv: Ref;
		through: string;
		sourceEvents: string[];
		policyRevision: string;
	}): Promise<{ session: string } | undefined>;
	inspect(
		request: { agent: string; conv: Ref; event?: string },
		ctx?: ToolContext,
	): Promise<{
		policy: SocialPolicy;
		sources: Record<string, string>;
		revision: string;
		capabilityGaps: string[];
		routeReason: string;
		cursor?: string;
		nextAt?: string;
	}>;
	update(
		request: {
			agent: string;
			conv: Ref;
			expectedRevision: string;
			patch: SocialPolicy & { mappings?: NonNullable<SocialConfig["mappings"]> };
			reason: string;
			dryRun?: boolean;
		},
		ctx?: ToolContext,
	): Promise<{ before: SocialPolicy; after: SocialPolicy; affected: Ref[]; revision: string }>;
	resume(
		request: {
			agent: string;
			conv: Ref;
			expectedRevision: string;
			through: string;
		},
		ctx?: ToolContext,
	): Promise<{ accepted: boolean; revision: string }>;
}
