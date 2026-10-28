export * from "./activity.js";
export * from "./approvals.js";
export * from "./attachments.js";
export * from "./bots.js";
export * from "./capabilities.js";
export * from "./catalog.js";
export * from "./channel.js";
export * from "./model.js";
export * from "./notify.js";
export * from "./session.js";
export * from "./session-open.js";
export * from "./usage.js";
export * from "./views.js";
export * from "./work.js";

import type { TSchema } from "typebox";
import { Check } from "typebox/value";
import { ActivitySummaryEvSchema, SessionSettledEvSchema } from "./activity.js";
import { ApprovalAnsweredEvSchema, ApprovalRequestedEvSchema } from "./approvals.js";
import { CapabilitiesChangedEvSchema } from "./capabilities.js";
import { ModelChangedEvSchema, ModelFallbackEvSchema, ReplyFailedEvSchema } from "./model.js";
import { NotificationEvSchema, SuggestionCreatedEvSchema } from "./notify.js";
import { RunEndedEvSchema, SessionLifecycleEvSchema, SessionUpdateSchema, TranscriptItemSchema } from "./session.js";
import { CompactionEvSchema, ContextUpdatedEvSchema, UsageUpdatedEvSchema } from "./usage.js";
import { ViewsChangedEvSchema } from "./views.js";
import {
	BackgroundUpdatedEvSchema,
	GoalUpdatedEvSchema,
	SubtaskUpdatedEvSchema,
	TodoUpdatedEvSchema,
	WakeUpdatedEvSchema,
} from "./work.js";

/** Payload schemas for the frozen event names. Unknown names remain forward compatible (§15). */
export const EVENT_SCHEMAS = {
	"session.update": SessionUpdateSchema,
	"activity.summary": ActivitySummaryEvSchema,
	"transcript.item": TranscriptItemSchema,
	"session.opened": SessionLifecycleEvSchema,
	"session.closed": SessionLifecycleEvSchema,
	"session.settled": SessionSettledEvSchema,
	"run.ended": RunEndedEvSchema,
	"usage.updated": UsageUpdatedEvSchema,
	"context.updated": ContextUpdatedEvSchema,
	"compaction.started": CompactionEvSchema,
	"compaction.finished": CompactionEvSchema,
	"model.changed": ModelChangedEvSchema,
	"model.fallback": ModelFallbackEvSchema,
	"reply.failed": ReplyFailedEvSchema,
	"todo.updated": TodoUpdatedEvSchema,
	"subtask.updated": SubtaskUpdatedEvSchema,
	"background.updated": BackgroundUpdatedEvSchema,
	"wake.updated": WakeUpdatedEvSchema,
	"goal.updated": GoalUpdatedEvSchema,
	"views.changed": ViewsChangedEvSchema,
	notification: NotificationEvSchema,
	"suggestion.created": SuggestionCreatedEvSchema,
	"approval.requested": ApprovalRequestedEvSchema,
	"approval.answered": ApprovalAnsweredEvSchema,
	"capabilities.changed": CapabilitiesChangedEvSchema,
} satisfies Record<string, TSchema>;
export const EVENT_TYPES = Object.freeze(Object.keys(EVENT_SCHEMAS) as (keyof typeof EVENT_SCHEMAS)[]);
export type EventType = keyof typeof EVENT_SCHEMAS;

export function validate(type: string, data: unknown): boolean {
	return !Object.hasOwn(EVENT_SCHEMAS, type) || Check(EVENT_SCHEMAS[type as EventType], data);
}
