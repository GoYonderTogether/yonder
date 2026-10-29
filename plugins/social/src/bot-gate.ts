/**
 * C5 bot gate: a pure decision function, no wording and no side effects.
 *
 * Bot-sourced messages are treated like human ones (never dropped, never filtered
 * here); they only carry a lower routing weight through their `bot` label. When the
 * counterpart looks like another AI — more than `threshold` bot messages inside one
 * `windowMin` window — the caller injects a hint so the model judges whether the
 * conversation is worth continuing.
 */
export interface BotGateEvent {
	/** Message time as ISO 8601 string or epoch milliseconds. */
	at: string | number;
	/** True when the message came from another bot/AI account. */
	bot: boolean;
}
/** `social.botGate` (IMP-02); every key falls back to the documented default. */
export interface BotGateConfig {
	windowMin?: number;
	threshold?: number;
	history?: number;
}
export interface BotGateHint {
	windowMin: number;
	threshold: number;
	/** Bot messages in the current window. */
	count: number;
	/** Bot message counts of the preceding windows, oldest first. */
	frequencies: number[];
}
export interface BotGateResult {
	inject: boolean;
	/** Bot message counts of the preceding windows, oldest first; length is `history`. */
	frequencies: number[];
	hint?: BotGateHint;
}
const defaults = { windowMin: 15, threshold: 3, history: 3 } as const;
const minute = 60_000;
const positive = (value: number | undefined, fallback: number) =>
	typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
const time = (value: string | number) => (typeof value === "number" ? value : Date.parse(value));

export function evaluateBotGate(input: {
	events: readonly BotGateEvent[];
	now: string | number;
	cfg?: BotGateConfig;
}): BotGateResult {
	const cfg = input.cfg ?? {};
	const windowMin = positive(cfg.windowMin, defaults.windowMin);
	const threshold = positive(cfg.threshold, defaults.threshold);
	const history = positive(cfg.history, defaults.history);
	const now = time(input.now);
	const window = windowMin * minute;
	const times = input.events.filter((event) => event.bot).map((event) => time(event.at));
	// Windows are half-open on the left: (start, end], so a boundary message belongs to the later window.
	const count = (start: number, end: number) => times.filter((at) => at > start && at <= end).length;
	const frequencies = Array.from({ length: history }, (_, index) =>
		count(now - (history - index + 1) * window, now - (history - index) * window),
	);
	const current = count(now - window, now);
	if (!Number.isFinite(now) || current <= threshold) return { inject: false, frequencies };
	return { inject: true, frequencies, hint: { windowMin, threshold, count: current, frequencies } };
}
