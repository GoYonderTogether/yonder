import Type, { type Static } from "typebox";

const T = Type.String();
const N = Type.Number();
const B = Type.Boolean();
const O = Type.Optional;
const A = Type.Array;

export const AgentsListParamsSchema = Type.Object({}, { additionalProperties: false });
export type AgentsListParams = Static<typeof AgentsListParamsSchema>;

export const WorkspacesListParamsSchema = Type.Object({}, { additionalProperties: false });
export type WorkspacesListParams = Static<typeof WorkspacesListParamsSchema>;

export const ModelsListParamsSchema = Type.Object({ provider: O(T) }, { additionalProperties: false });
export type ModelsListParams = Static<typeof ModelsListParamsSchema>;

export const ModelsListResultSchema = Type.Object(
	{
		providers: A(
			Type.Object({
				id: T,
				models: A(Type.Object({ id: T, name: T, contextWindow: N, reasoning: B }, { additionalProperties: false })),
			}),
		),
	},
	{ additionalProperties: false },
);
export type ModelsListResult = Static<typeof ModelsListResultSchema>;

export const AgentsListResultSchema = Type.Object(
	{ agents: A(Type.Object({ id: T, name: T, profile: T, presets: A(T) }, { additionalProperties: false })) },
	{ additionalProperties: false },
);
export type AgentsListResult = Static<typeof AgentsListResultSchema>;

export const WorkspacesListResultSchema = Type.Object(
	{ roots: A(Type.Object({ id: T, label: T, path: O(T) }, { additionalProperties: false })) },
	{ additionalProperties: false },
);
export type WorkspacesListResult = Static<typeof WorkspacesListResultSchema>;

export const UpdateStateSchema = Type.Object(
	{
		state: Type.Union([
			Type.Literal("idle"),
			Type.Literal("checking"),
			Type.Literal("downloading"),
			Type.Literal("ready"),
			Type.Literal("applying"),
			Type.Literal("failed"),
		]),
		current: T,
		latest: O(T),
		progress: O(N),
		error: O(T),
	},
	{ additionalProperties: false },
);
export type UpdateState = Static<typeof UpdateStateSchema>;

export const UpdateStatusParamsSchema = Type.Object({}, { additionalProperties: false });
export type UpdateStatusParams = Static<typeof UpdateStatusParamsSchema>;

export const UpdateDownloadParamsSchema = Type.Object({}, { additionalProperties: false });
export type UpdateDownloadParams = Static<typeof UpdateDownloadParamsSchema>;

export const UpdateApplyParamsSchema = Type.Object({}, { additionalProperties: false });
export type UpdateApplyParams = Static<typeof UpdateApplyParamsSchema>;

export const UpdateStatusResultSchema = UpdateStateSchema;
export type UpdateStatusResult = Static<typeof UpdateStatusResultSchema>;

export const UpdateDownloadResultSchema = UpdateStateSchema;
export type UpdateDownloadResult = Static<typeof UpdateDownloadResultSchema>;

export const UpdateApplyResultSchema = Type.Object({ ok: B, hint: O(T) }, { additionalProperties: false });
export type UpdateApplyResult = Static<typeof UpdateApplyResultSchema>;
