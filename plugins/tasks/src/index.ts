import { type Capability, definePlugin, type ToolContext, type TSchema } from "@yonder/sdk";
import { DONE, GET, LIST, OPEN, UPDATE } from "./prompts.js";
import { type Open, Store, type Update } from "./store.js";

const string = { type: "string", minLength: 1, pattern: "\\S" };
const strings = { type: "array", items: string };
const obj = (properties: object, required = Object.keys(properties)): TSchema =>
	({ type: "object", properties, required, additionalProperties: false }) as TSchema;
const content = {
	title: string,
	objective: string,
	acceptance: { ...strings, minItems: 2, maxItems: 5 },
	nonGoals: strings,
	budget: obj({ wallMinutes: { type: "number", exclusiveMinimum: 0 }, wakeups: { type: "integer", minimum: 1 } }, []),
};
export default definePlugin({
	setup(api) {
		const store = new Store(api.paths.data);
		const add = (
			name: string,
			description: string,
			parameters: TSchema,
			capabilities: Capability[],
			run: (args: Record<string, unknown>, ctx: ToolContext) => unknown,
		) =>
			api.tools.register({
				name: `tasks_${name}`,
				description,
				parameters,
				capabilities,
				async execute(args, ctx) {
					try {
						ctx.signal.throwIfAborted();
						return { text: JSON.stringify(run(args as Record<string, unknown>, ctx)) };
					} catch (error) {
						return { text: error instanceof Error ? error.message : String(error), isError: true };
					}
				},
			});
		add(
			"open",
			OPEN,
			obj({ ...content, parent: string, origin: string }, ["title", "objective", "acceptance", "nonGoals"]),
			["write"],
			(args, ctx) => store.open(args as unknown as Open, ctx),
		);
		add(
			"update",
			UPDATE,
			obj(
				{
					id: string,
					...content,
					state: { enum: ["active", "waiting-user", "blocked", "review", "cancelled"] },
					deliverable: string,
					note: string,
				},
				["id"],
			),
			["write"],
			({ id, ...patch }, ctx) => store.update(id as string, patch as Update, ctx),
		);
		add(
			"done",
			DONE,
			obj({ id: string, deliverable: string, evidence: { ...strings, minItems: 2, maxItems: 5 } }),
			["write"],
			(args, ctx) => store.done(args.id as string, args.deliverable as string, args.evidence as string[], ctx),
		);
		add("list", LIST, obj({}), ["read"], (_args, ctx) => store.list(ctx));
		add("get", GET, obj({ id: string }), ["read"], (args, ctx) => store.get(args.id as string, ctx));
		api.contexts.register({ id: "tasks-turn", placement: "turn", render: (ctx) => store.render(ctx) });
	},
});
