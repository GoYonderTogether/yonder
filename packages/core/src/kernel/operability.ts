export type OperabilitySelector = { conv?: string; eventId?: string };
export type SessionOperabilityFact = {
	status: "observed" | "unknown";
	selector: OperabilitySelector;
	reason?: string;
	sample?: { eventId: string; conv: string; kind?: string };
	history?: {
		route?: { binding: string | null; session?: string; profile?: string; wake?: string; dropped?: string };
		participation?: {
			policy?: unknown;
			reason?: string;
			plugin?: string;
			revision?: string;
			repair?: string;
			consumerIssue?: string;
			profile?: string;
		};
		execution: {
			state: "direct" | "batch" | "not-observed" | "unknown";
			runs?: Array<{ runId?: string; status?: string; path: "direct" | "batch" }>;
		};
		delivery: {
			state: "delivered" | "not-observed" | "unknown";
			receipts?: Array<{ eventId: string; session?: string }>;
		};
	};
	prediction?: {
		state: "matched" | "no-match" | "unknown";
		route?: "accepted" | "dropped";
		dropReason?: "no-binding";
		binding?: string;
		profile?: string;
		wake?: string;
		participation?: { reason?: string; plugin?: string; revision?: string; run?: boolean; policy?: unknown };
		participationScope?: {
			enabled?: boolean;
			scope?: string[];
			includesConversation: boolean;
			conversationOverride?: unknown;
			defaults?: unknown;
		};
		consumer?: {
			state: "available" | "unavailable" | "not-applicable";
			binding?: string;
			issue?: string;
			profile?: string;
			plugin?: string;
			pluginSelected?: boolean;
			matchingConsumer?: boolean;
			derived?: boolean;
		};
		reply?: "auto" | "none";
		deliver?: { to: string; via?: string };
		capabilities?: {
			values: string[];
			plugins?: string[];
			tools: { offer: string[]; search: string[] };
			channelInstances?: string[];
			messageSend: boolean;
		};
	};
	configuration?: {
		basis: "accepted" | "candidate";
		revision?: string;
		diskRevision?: string;
		acceptedRevision?: string;
		state?: string;
	};
};
