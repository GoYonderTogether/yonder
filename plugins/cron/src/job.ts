import type { WorkspaceResource } from "@yonder/sdk";
import {
	type Attachment,
	assertChannelInstance,
	type Capability,
	type ExecutionOwner,
	parseRef,
	type ToolContext,
	type TSchema,
} from "@yonder/sdk";
import { instant, type Schedule, validateSchedule } from "./schedule.js";

export type Owner = Pick<ToolContext, "session" | "agent" | "profile">;
export type Payload =
	| { kind: "event"; type: string; target: string; data: Record<string, unknown> }
	| { kind: "preset"; preset: string; text: string }
	| { kind: "command"; command: string | string[]; cwd?: string }
	| { kind: "script"; path: string; interpreter: string; args?: string[]; cwd?: string };
export interface Job {
	id: string;
	name: string;
	owner: Owner;
	/** Native source captured when the program is created or deliberately changed. */
	executionOwner?: ExecutionOwner;
	resources?: WorkspaceResource[];
	capabilities: Capability[];
	schedule: Schedule;
	payload: Payload;
	delivery?: { to: string; via?: string };
	enabled: boolean;
	missed: "coalesce" | "skip";
	start?: string;
	end?: string;
	maxRuns?: number;
	runs: number;
	next: number | null;
	created: string;
	updated: string;
}
export interface RecordRun {
	id: string;
	job: string;
	scheduled: number | null;
	started: string;
	ended?: string;
	status: "running" | "done" | "run-failed" | "delivery-failed" | "schedule-failed" | "interrupted" | "skipped";
	text?: string;
	attachments?: Attachment[];
	error?: string;
	deliveryError?: string;
	event?: string;
	session?: string;
}
const string = { type: "string", minLength: 1 };
const strings = { type: "array", items: string };
const object = (properties: object, required: string[] = []) => ({
	type: "object",
	properties,
	required,
	additionalProperties: false,
});
const command = { anyOf: [string, { ...strings, minItems: 1 }] };
const scheduleSchema = {
	anyOf: [
		object({ kind: { const: "at" }, at: string, timezone: string }, ["kind", "at", "timezone"]),
		object(
			{ kind: { const: "every" }, milliseconds: { type: "integer", minimum: 1000 }, anchor: string, timezone: string },
			["kind", "milliseconds", "anchor", "timezone"],
		),
		object({ kind: { const: "cron" }, expression: string, timezone: string }, ["kind", "expression", "timezone"]),
	],
};
const payloadSchema = {
	anyOf: [
		object({ kind: { const: "event" }, type: string, target: string, data: { type: "object" } }, [
			"kind",
			"type",
			"target",
			"data",
		]),
		object({ kind: { const: "preset" }, preset: string, text: string }, ["kind", "preset", "text"]),
		object({ kind: { const: "command" }, command, cwd: string }, ["kind", "command"]),
		object({ kind: { const: "script" }, path: string, interpreter: string, args: strings, cwd: string }, [
			"kind",
			"path",
			"interpreter",
		]),
	],
};
const jobProperties = {
	name: string,
	schedule: scheduleSchema,
	payload: payloadSchema,
	delivery: { anyOf: [object({ to: string, via: string }, ["to"]), { type: "null" }] },
	enabled: { type: "boolean" },
	missed: { enum: ["coalesce", "skip"] },
	start: { anyOf: [string, { type: "null" }] },
	end: { anyOf: [string, { type: "null" }] },
	maxRuns: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] },
};
export const parameters = object(
	{
		action: { enum: ["create", "get", "list", "update", "enable", "disable", "delete", "run", "history"] },
		id: string,
		job: object(jobProperties),
		limit: { type: "integer", minimum: 1, maximum: 100 },
	},
	["action"],
) as TSchema;
export const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
export function checkDelivery(delivery: NonNullable<Job["delivery"]>, scope: { channelInstances?: string[] }) {
	const target = parseRef(delivery.to);
	if (target.kind !== "conv" && target.kind !== "acct")
		throw new Error("Delivery target must be explicit channel conv/acct reference");
	if (delivery.via && delivery.via !== target.channel) throw new Error("via does not match delivery target instance");
	assertChannelInstance(scope, target.channel);
}
export function sameOwner(job: Job, ctx: ToolContext): boolean {
	return job.owner.agent === null
		? ctx.agent === null && job.owner.session === ctx.session
		: job.owner.agent === ctx.agent && job.owner.profile === ctx.profile;
}
export function validateJob(job: Job) {
	validateSchedule(job.schedule);
	if (job.start !== undefined) instant(job.start);
	if (job.end !== undefined) instant(job.end);
	if (job.start && job.end && instant(job.start) > instant(job.end)) throw new Error("start must not exceed end");
	if (job.payload.kind === "event") {
		if (!job.capabilities.includes("admin"))
			throw new Error(
				"admin capability required for raw event schedules; use a capability-scoped preset for ordinary tasks",
			);
		if (!job.payload.type.startsWith("cron.") || !/^cron\.[a-zA-Z0-9_.-]+$/.test(job.payload.type))
			throw new Error("Event type must be in cron.* namespace");
		const ref = parseRef(job.payload.target);
		if (ref.kind !== "conv")
			throw new Error("Event target must be an explicit conv reference; Agent wakeup requires configured bindings");
	}
	if (job.delivery) {
		const target = parseRef(job.delivery.to);
		if (target.kind !== "conv" && target.kind !== "acct")
			throw new Error("Delivery target must be explicit channel conv/acct reference");
		if (!job.capabilities.includes("message")) throw new Error("message capability required for channel delivery");
	}
	if (["command", "script"].includes(job.payload.kind) && !job.capabilities.includes("exec"))
		throw new Error("exec capability required");
}
