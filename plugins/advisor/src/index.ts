import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { definePlugin } from "@yonder/sdk";
import { Type } from "typebox";

const configSchema = Type.Object({ outcomeLogging: Type.Optional(Type.Boolean()) }, { additionalProperties: false });
const adoption = Type.Union([Type.Literal("followed"), Type.Literal("not-followed"), Type.Literal("unknown")]);
const validation = Type.Union([
	Type.Literal("passed"),
	Type.Literal("failed"),
	Type.Literal("not-run"),
	Type.Literal("unknown"),
]);

export default definePlugin({
	configSchema,
	setup(api) {
		const enabled = (api.config as { outcomeLogging?: boolean } | undefined)?.outcomeLogging === true;
		const key = randomBytes(32);
		const advice = new Map<string, { session: string; hash: string; reserved: boolean }>();
		api.tools.register({
			name: "advisor_consult",
			description: "Consult a task preset and return advice with an ID for optional outcome recording.",
			parameters: Type.Object(
				{ preset: Type.String({ minLength: 1 }), task: Type.String({ minLength: 1 }) },
				{ additionalProperties: false },
			),
			capabilities: [],
			async execute(args, ctx) {
				const result = await api.subagents.run(args as { preset: string; task: string }, ctx);
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
				return { ...result, text: `adviceId: ${id}\n${output}` };
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
						`${JSON.stringify({ adviceHash: item.hash, timestamp: new Date().toISOString(), adoption: value.adoption, validationStatus: value.validationStatus })}\n`,
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
