import { type ConversationId, defineDoc, defineDocFamily, type UsageState } from "@earendil-works/pi-durable";
import type { Capability, SessionModels } from "@yonder/sdk";
import type { RuntimeRun, RuntimeSessionConfig } from "./types.js";

export const SessionDoc = defineDoc({
	kind: "yonder.session",
	version: 1,
	scope: "conversation",
	history: "latest",
	fork: "current",
	initial: () => ({
		models: null as SessionModels | null,
		agent: null as string | null,
		profile: "",
		cwd: "",
		env: "local",
		capabilities: null as Capability[] | null,
		close: "run-end" as "run-end" | "manual",
	}),
});
export const cid = (id: string) => Number(id) as ConversationId;
export const emptyUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
export function submissionOutcome(
	done: { status: "done" } | { status: "unanswered"; reason: string; detail?: unknown },
	limitReason?: string,
): { status: RuntimeRun["status"]; reason?: string } {
	if (limitReason) return { status: "limit", reason: limitReason };
	if (done.status === "done") return { status: "done" };
	return {
		status: done.reason.includes("abort") ? "aborted" : "error",
		reason:
			typeof done.detail === "string" && done.detail
				? `${done.reason}: ${done.detail.replace(/(Bearer\s+)\S+/gi, "$1[redacted]").replace(/((?:api[_-]?key|access_token|refresh_token)[\s"']*[:=][\s"']*)[^\s,"'&}]+/gi, "$1[redacted]")}`
				: done.reason,
	};
}
export const RunDoc = defineDocFamily({
	kind: "yonder.run",
	version: 1,
	family: true,
	scope: "conversation",
	history: "latest",
	fork: "initial",
	initial: (_seed: null) => ({
		config: "",
		started: 0,
		turns: 0,
		networkInterrupted: false as boolean,
		previous: "",
		repeats: 0,
		reason: null as string | null,
		error: null as string | null,
		usageBefore: emptyUsage(),
		toolTasks: [] as number[],
		warnings: [] as string[],
	}),
});

export interface RunState {
	started: number;
	warnings: Set<string>;
	error?: string;
	toolTasks: number[];
	usageBefore: RuntimeRun["usage"];
	id: string;
	session: string;
	config: RuntimeSessionConfig;
	turns: number;
	previous?: { name: string; args: unknown };
	repeats: number;
	reason?: string;
	timer: ReturnType<typeof setTimeout> | undefined;
	deadline: number;
}

export function sumUsage(state?: Readonly<UsageState>): RuntimeRun["usage"] {
	const sum = emptyUsage();
	for (const usage of [...Object.values(state?.models ?? {}), ...Object.values(state?.tools ?? {})]) {
		for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const) sum[key] += usage[key];
		sum.cost += usage.cost.total;
	}
	return sum;
}
