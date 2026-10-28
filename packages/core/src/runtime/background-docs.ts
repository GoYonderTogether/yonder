import {
	defineDoc,
	defineDocFamily,
	type JsonObject,
	type TaskOutcome,
	type ToolExecutionResult,
} from "@earendil-works/pi-durable";

export const JobDoc = defineDocFamily({
	kind: "yonder.background",
	version: 1,
	family: true,
	scope: "conversation",
	history: "latest",
	fork: "initial",
	initial: () => ({
		name: "",
		started: 0,
		output: "",
		next: 0,
		detached: false as boolean,
		notified: false as boolean,
	}),
});
export const JobPointer = defineDoc({
	kind: "yonder.background-pointer",
	version: 1,
	scope: "task",
	initial: () => ({ id: 0 }),
});
export type Input = { name: string; args: JsonObject; callId: string; config: string };
export type State = { phase: "start" | "interrupted" };
export const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export const failed = (error: unknown): ToolExecutionResult => ({
	output: [{ type: "text", text: String(error) }],
	isError: true,
});
export const json = (value: unknown): ToolExecutionResult => ({
	output: [{ type: "text", text: JSON.stringify(value) }],
});
export const outcomeResult = (outcome: TaskOutcome<ToolExecutionResult>): ToolExecutionResult =>
	outcome.status === "completed"
		? outcome.result
		: "result" in outcome && outcome.result
			? outcome.result
			: failed(
					"error" in outcome
						? outcome.error.message
						: `${outcome.status}: ${outcome.reason ?? "Background task did not complete"}`,
				);
