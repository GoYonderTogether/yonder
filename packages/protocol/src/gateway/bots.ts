import Type, { type Static } from "typebox";
import { InputReceiptSchema } from "./session.js";

const T = Type.String();
const N = Type.Number();
const O = Type.Optional;
const A = Type.Array;

export const BotSchema = Type.Object(
	{ agent: T, name: T, work: O(T), session: O(T), channels: A(T), sessionsOverview: N },
	{ additionalProperties: false },
);
export type Bot = Static<typeof BotSchema>;

export const BotsListParamsSchema = Type.Object({}, { additionalProperties: false });
export type BotsListParams = Static<typeof BotsListParamsSchema>;

export const BotsListResultSchema = Type.Object({ bots: A(BotSchema) }, { additionalProperties: false });
export type BotsListResult = Static<typeof BotsListResultSchema>;

export const BotsSendParamsSchema = Type.Object(
	{ agent: T, text: T, requestId: O(T) },
	{ additionalProperties: false },
);
export type BotsSendParams = Static<typeof BotsSendParamsSchema>;

export const BotsSendResultSchema = InputReceiptSchema;
export type BotsSendResult = Static<typeof BotsSendResultSchema>;
