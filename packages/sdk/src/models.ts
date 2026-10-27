import type { Capability, Level } from "./types.js";

/** Model, thinking and fallback selection for a session; the fallback chain is expanded by the runtime (07 §6.1). */
export type SessionModels = {
	/** Non-secret provider -> credential slot selection. Merge per provider; explicit "default" resets inheritance. */
	credentialSlots?: Record<string, string>;
	model?: string;
	thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
	fallback?: {
		models: string[];
		/** Same model on other credential slots, tried before `models` (spec 03 §3, 07 §6.1). */
		accounts?: Record<string, string[]>;
		/** Per slot model substitution, keyed by slot then `provider/model` (e.g. a limited account runs a smaller model). */
		accountModels?: Record<string, Record<string, string>>;
		/** Per slot: stop choosing the account once its official usage window is at or above this percent. */
		quotaStopPercent?: Record<string, number>;
		after?: number;
		/** Seconds a model stays out of the starting position after it proved unusable. */
		hold?: number;
		/** Seconds between background probes of a held model. */
		probe?: number;
	};
};
/** One configured way of running an agent: model, tools, instructions, level, execution environment. */
export interface Profile extends SessionModels {
	level?: Level;
	capabilities?: Capability[];
	/** Undefined preserves legacy unrestricted access; [] permits no channel instances. */
	channelInstances?: string[];
	plugins?: string[];
	tools?: { offer?: string[]; search?: string[] };
	contexts?: string[];
	skills?: string[];
	prompt?: { sections?: string[]; overrides?: Record<string, string> };
	instructions?: string;
	env?: string;
	limits?: { maxTurns?: number; maxMinutes?: number; maxTokens?: number; repeatBlock?: number; repeatStop?: number };
}
/** A profile that belongs to no agent, used for temporary sessions. */
export type Preset = Profile & { id: string; description: string };
