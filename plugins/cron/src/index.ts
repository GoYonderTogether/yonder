import { definePlugin } from "@yonder/sdk";
import Type from "typebox";
import { Check } from "typebox/value";
import { errorText, parameters } from "./job.js";
import { Scheduler } from "./scheduler.js";

export { Scheduler } from "./scheduler.js";

const ownerSchema = Type.Object(
	{
		session: Type.String({ minLength: 1 }),
		agent: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
		profile: Type.String({ minLength: 1 }),
	},
	{ additionalProperties: false },
);

export default definePlugin({
	async setup(api) {
		const config = api.config as { concurrency?: number } | undefined;
		const concurrency = config?.concurrency ?? 4;
		if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 64)
			throw new Error("cron concurrency must be integer 1..64");
		const scheduler = new Scheduler(api, concurrency);
		api.triggers.register({
			id: "cron",
			start: (io) => scheduler.start(io),
			tick: (now) => scheduler.tick(now),
			stop: () => scheduler.stop(),
		});
		api.views.register(
			{
				id: "cron.manage",
				plugin: "cron",
				title: "Cron",
				placement: "page",
				scope: "node",
				actions: ["manage"],
				actScope: "owner",
			},
			{
				data: () => ({ viewId: "cron.manage", rev: 0, content: { type: "markdown", text: "Cron management" } }),
				async act(_action, input) {
					const { owner, ...request } = (input ?? {}) as Record<string, unknown>;
					if (owner !== undefined && (request.action !== "create" || !Check(ownerSchema, owner)))
						throw new Error("Invalid execution owner");
					return {
						content: {
							type: "markdown",
							text: JSON.stringify(
								await scheduler.manage(request, undefined, true, owner as Parameters<Scheduler["manage"]>[3]),
							),
						},
					};
				},
			},
		);
		for (const exec of [false, true])
			api.tools.register({
				name: exec ? "cron_exec" : "cron_manage",
				description: exec
					? "Manage owned scheduled jobs including no-model command/script jobs; admin may manage other owners' jobs without changing their owner or execution ceiling. Prefer deterministic checks/forwarding instead of waking a model. Check existing jobs before creating, use explicit timezone/targets, retain the returned id and update or stop it when the purpose changes. Inspect history to distinguish scheduling, execution and delivery failure before retrying; unknown side effects must not be replayed. The local host must be awake and running."
					: "Manage owned cron event/preset jobs; admin may manage other owners' jobs without changing their owner or execution ceiling. CRUD, enable/disable, run and history. A note is not a schedule: verify the saved job and retain its id. Check for an existing matching job, use explicit timezone/targets and stop obsolete jobs. Keep unchanged checks quiet unless periodic updates were requested. Diagnose the actual history stage before retrying; a saved job is not a successful run or delivered message. The local host must be awake and running.",
				parameters,
				capabilities: exec ? ["write", "exec"] : ["write"],
				async execute(args, ctx) {
					try {
						return { text: JSON.stringify(await scheduler.manage(args, ctx, exec), null, 2) };
					} catch (error) {
						return { text: errorText(error), isError: true };
					}
				},
			});
	},
});
