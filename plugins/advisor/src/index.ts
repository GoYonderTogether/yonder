import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ToolContext, ToolResult } from "@yonder/sdk";
import { definePlugin } from "@yonder/sdk";
import { Type } from "typebox";

const configSchema = Type.Object(
	{ outcomeLogging: Type.Optional(Type.Boolean()), preset: Type.Optional(Type.String({ minLength: 1 })) },
	{ additionalProperties: false },
);
const adoption = Type.Union([Type.Literal("followed"), Type.Literal("not-followed"), Type.Literal("unknown")]);
const validation = Type.Union([
	Type.Literal("passed"),
	Type.Literal("failed"),
	Type.Literal("not-run"),
	Type.Literal("unknown"),
]);

/** `init` always writes this preset, so an empty `ask_advisor` call has a target without extra configuration. */
const defaultPreset = "default";
const contextualReview = "Give a second opinion on the current task, risks, proposed direction, and validation.";

interface Consultation {
	preset: string;
	task: string;
	followUp?: string;
}

export default definePlugin({
	configSchema,
	setup(api) {
		const config = (api.config ?? {}) as { outcomeLogging?: boolean; preset?: string };
		const enabled = config.outcomeLogging === true;
		const preset = config.preset ?? defaultPreset;
		const key = randomBytes(32);
		const advice = new Map<string, { session: string; hash: string; reserved: boolean }>();

		const assertFollowUp = (adviceId: string, ctx: ToolContext) => {
			const item = advice.get(adviceId);
			if (!item || item.session !== ctx.session)
				throw new Error(
					`Follow-up unavailable for adviceId ${adviceId}: unknown, already recorded, or from another session. Issue a fresh consultation instead.`,
				);
		};

		const taskFrom = (request: { draft?: string; question?: string }): string => {
			const question = request.question?.trim();
			const draft = request.draft?.trim();
			if (question && draft) return `${question}\n\nDraft (unverified Executor claim, not evidence):\n${draft}`;
			if (question) return question;
			if (draft) return `Review this draft (unverified Executor claim, not evidence):\n${draft}`;
			return contextualReview;
		};

		const consult = async (request: Consultation, ctx: ToolContext): Promise<ToolResult> => {
			const result = await api.subagents.run({ preset: request.preset, task: request.task }, ctx);
			if (result.isError) return result;
			const taskResult = JSON.parse(result.text) as { text: string; resultFile?: string };
			const id = randomUUID();
			advice.set(id, {
				session: ctx.session,
				hash: createHmac("sha256", key).update(taskResult.text).digest("hex").slice(0, 16),
				reserved: false,
			});
			let output = taskResult.text;
			if (Buffer.byteLength(output) > 30_000) {
				const ref = taskResult.resultFile ?? (await ctx.cacheToolOutput?.(output));
				output = `${output.slice(0, 30_000)}\n[Output truncated; ${ref ? `full output: ${ref}` : "cache unavailable"}]`;
			}
			const link = request.followUp ? `\nfollowUp: ${request.followUp}` : "";
			return { ...result, text: `adviceId: ${id}${link}\n${output}` };
		};

		api.tools.register({
			name: "ask_advisor",
			description:
				"Consult the on-demand Advisor model for strategic guidance. Call with an empty object for a contextual review; attach an optional draft for concrete plan or completion review. Use followUp with the adviceId of an earlier consultation in this session and a new question to continue it without restating the context; do not combine followUp with draft.",
			parameters: Type.Object(
				{
					draft: Type.Optional(
						Type.String({
							description:
								"Concise untrusted draft for plan or completion review; claims are not verification evidence.",
						}),
					),
					followUp: Type.Optional(
						Type.String({
							description:
								"Opaque adviceId from a prior consultation in this session. Requires a non-empty question and must not be combined with draft.",
						}),
					),
					question: Type.Optional(
						Type.String({
							description:
								"The specific question or decision to get advice on. Omit this for normal reviews: the Advisor already has the conversation context.",
						}),
					),
				},
				{ additionalProperties: false },
			),
			capabilities: [],
			async execute(args, ctx) {
				const value = args as { draft?: string; followUp?: string; question?: string };
				if (value.followUp !== undefined) {
					if (!value.question?.trim()) throw new Error("A follow-up consultation needs a non-empty question.");
					if (value.draft !== undefined)
						throw new Error(
							"Follow-up consultations accept only followUp and a non-empty question; issue a fresh consultation for a draft.",
						);
					assertFollowUp(value.followUp, ctx);
				}
				const request: Consultation = { preset, task: taskFrom(value) };
				if (value.followUp !== undefined) request.followUp = value.followUp;
				return consult(request, ctx);
			},
		});
		api.tools.register({
			name: "advisor_consult",
			description:
				"Deprecated alias of ask_advisor: consult a task preset and return advice with an ID for optional outcome recording.",
			parameters: Type.Object(
				{ preset: Type.String({ minLength: 1 }), task: Type.String({ minLength: 1 }) },
				{ additionalProperties: false },
			),
			capabilities: [],
			async execute(args, ctx) {
				const value = args as { preset: string; task: string };
				return consult({ preset: value.preset, task: value.task }, ctx);
			},
		});
		api.tools.register({
			name: "advisor_record_advisor_outcome",
			description: "Voluntarily record the adoption and validation of an advice ID when outcome logging is enabled.",
			parameters: Type.Object(
				{ adviceId: Type.String({ minLength: 1 }), adoption, validationStatus: validation },
				{ additionalProperties: false },
			),
			capabilities: [],
			async execute(args, ctx) {
				if (!enabled) return { text: JSON.stringify({ recorded: false, reason: "outcome logging disabled" }) };
				const value = args as { adviceId: string; adoption: string; validationStatus: string };
				const item = advice.get(value.adviceId);
				if (!item || item.session !== ctx.session || item.reserved)
					return {
						text: JSON.stringify({ recorded: false, reason: "unknown, already recorded, or pending adviceId" }),
					};
				item.reserved = true;
				try {
					await mkdir(api.paths.data, { recursive: true, mode: 0o700 });
					await appendFile(
						join(api.paths.data, "outcomes.jsonl"),
						`${JSON.stringify({ v: 1, adviceHash: item.hash, timestamp: new Date().toISOString(), adoption: value.adoption, validationStatus: value.validationStatus })}\n`,
						{ mode: 0o600 },
					);
					advice.delete(value.adviceId);
					return { text: JSON.stringify({ recorded: true }) };
				} catch {
					item.reserved = false;
					return { text: JSON.stringify({ recorded: false, reason: "write failed; retry allowed" }) };
				}
			},
		});
	},
});
