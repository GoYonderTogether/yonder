import Type, { type Static } from "typebox";

const T = Type.String();
const N = Type.Number();
const B = Type.Boolean();
const O = Type.Optional;
const A = Type.Array;

export const TodoItemSchema = Type.Object(
	{
		id: T,
		text: T,
		state: Type.Union([Type.Literal("todo"), Type.Literal("doing"), Type.Literal("done"), Type.Literal("cancelled")]),
		parent: O(T),
		order: N,
	},
	{ additionalProperties: false },
);
export type TodoItem = Static<typeof TodoItemSchema>;

export const TodoUpdatedEvSchema = Type.Object(
	{ session: T, done: N, total: N, items: A(TodoItemSchema) },
	{ additionalProperties: false },
);
export type TodoUpdatedEv = Static<typeof TodoUpdatedEvSchema>;

export const SubtaskRowSchema = Type.Object(
	{
		id: T,
		session: T,
		label: T,
		state: Type.Union([
			Type.Literal("running"),
			Type.Literal("waiting"),
			Type.Literal("done"),
			Type.Literal("error"),
			Type.Literal("aborted"),
		]),
		startedAt: T,
		lastOutputAt: O(T),
	},
	{ additionalProperties: false },
);
export type SubtaskRow = Static<typeof SubtaskRowSchema>;

export const SubtaskUpdatedEvSchema = Type.Object(
	{ session: T, rows: A(SubtaskRowSchema) },
	{ additionalProperties: false },
);
export type SubtaskUpdatedEv = Static<typeof SubtaskUpdatedEvSchema>;

export const BackgroundRowSchema = Type.Object(
	{
		id: T,
		label: T,
		state: Type.Union([Type.Literal("running"), Type.Literal("exited")]),
		exitCode: O(N),
		startedAt: T,
	},
	{ additionalProperties: false },
);
export type BackgroundRow = Static<typeof BackgroundRowSchema>;

export const BackgroundUpdatedEvSchema = Type.Object(
	{ session: T, rows: A(BackgroundRowSchema) },
	{ additionalProperties: false },
);
export type BackgroundUpdatedEv = Static<typeof BackgroundUpdatedEvSchema>;

export const WakeRowSchema = Type.Object(
	{
		id: T,
		at: T,
		source: Type.Union([
			Type.Literal("channel"),
			Type.Literal("cron"),
			Type.Literal("voice"),
			Type.Literal("manual"),
			Type.Literal("other"),
		]),
		channel: O(T),
		from: O(T),
		summary: O(T),
	},
	{ additionalProperties: false },
);
export type WakeRow = Static<typeof WakeRowSchema>;

export const WakeUpdatedEvSchema = Type.Object({ session: T, rows: A(WakeRowSchema) }, { additionalProperties: false });
export type WakeUpdatedEv = Static<typeof WakeUpdatedEvSchema>;

export const GoalUpdatedEvSchema = Type.Object(
	{
		session: T,
		goal: Type.Union([
			Type.Null(),
			Type.Object(
				{
					text: T,
					state: Type.Union([
						Type.Literal("active"),
						Type.Literal("paused"),
						Type.Literal("done"),
						Type.Literal("abandoned"),
					]),
					steps: O(A(Type.Object({ text: T, done: B }, { additionalProperties: false }))),
					updatedAt: T,
				},
				{ additionalProperties: false },
			),
		]),
	},
	{ additionalProperties: false },
);
export type GoalUpdatedEv = Static<typeof GoalUpdatedEvSchema>;
