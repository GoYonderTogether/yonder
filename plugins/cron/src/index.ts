import { definePlugin } from "@yonder/sdk";
import { errorText, parameters } from "./job.js";
import { Scheduler } from "./scheduler.js";

export { Scheduler } from "./scheduler.js";

export default definePlugin({
	async setup(api) {
		const config = api.config as { concurrency?: number } | undefined;
		const concurrency = config?.concurrency ?? 4;
		if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 64)
			throw new Error("cron concurrency must be integer 1..64");
		const scheduler = new Scheduler(api, concurrency);
		api.triggers.register({ id: "cron", start: () => scheduler.start(), stop: () => scheduler.stop() });
		for (const exec of [false, true])
			api.tools.register({
				name: exec ? "cron_exec" : "cron_manage",
				description: exec
					? "Manage owned scheduled jobs including no-model command/script jobs. Prefer these for deterministic checks/forwarding instead of waking a model. Check existing jobs before creating, use explicit timezone/targets, retain the returned id and update or stop it when the purpose changes. Inspect history to distinguish scheduling, execution and delivery failure before retrying; unknown side effects must not be replayed. The local host must be awake and running."
					: "Manage owned cron event/preset jobs; CRUD, enable/disable, run and history. A note is not a schedule: verify the saved job and retain its id. Check for an existing matching job, use explicit timezone/targets and stop obsolete jobs. Keep unchanged checks quiet unless periodic updates were requested. Diagnose the actual history stage before retrying; a saved job is not a successful run or delivered message. The local host must be awake and running.",
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
