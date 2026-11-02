import type { EventInput, PluginAPI, TriggerIO } from "@yonder/sdk";
import { checkDelivery, errorText, type Job, type RecordRun } from "./job.js";
import { recordRun as writeRun } from "./persistence.js";

/** Runs one job payload, then delivers its result; the run receipt is the durable fact for both stages. */
export async function executeRun(
	api: PluginAPI,
	job: Job,
	run: RecordRun,
	active: { controller: AbortController; session?: string | undefined },
	emit: TriggerIO["emit"] = api.events.emit,
): Promise<RecordRun> {
	try {
		await emit({
			type: "cron.started",
			from: "plugin:cron",
			data: { job: job.id, run: run.id, scheduled: run.scheduled },
		});
		const authority = await api.execution.resolve(job.owner);
		const capabilities = job.capabilities.filter((c) => authority.capabilities.includes(c));
		if (job.delivery) {
			if (!capabilities.includes("message")) throw new Error("Creator message capability revoked");
			checkDelivery(job.delivery, authority);
		}
		const payload = job.payload;
		if (payload.kind === "event") {
			const event: EventInput = {
				type: payload.type,
				from: "plugin:cron",
				data: { ...payload.data, target: payload.target, cron: { job: job.id, run: run.id } },
			};
			if (payload.target.startsWith("conv:")) event.conv = payload.target;
			const result = await new Promise<Awaited<ReturnType<PluginAPI["events"]["ask"]>>>((resolve, reject) => {
				const abort = () => reject(new Error("Service stopped after event dispatch; Agent run is owned by kernel"));
				active.controller.signal.addEventListener("abort", abort, { once: true });
				if (active.controller.signal.aborted) {
					abort();
					return;
				}
				void api.events
					.ask(event)
					.then(resolve, reject)
					.finally(() => active.controller.signal.removeEventListener("abort", abort));
			});
			run.event = result.event.id;
			run.text = result.results.map((r) => r.text).join("\n\n");
			run.attachments = result.results.flatMap((r) => r.attachments ?? []);
			if (result.results.some((r) => r.status !== "done"))
				throw new Error(result.results.map((r) => r.reason || r.status).join("; "));
		} else if (payload.kind === "preset") {
			const session = await api.sessions.open({
				preset: payload.preset,
				parent: job.owner.session,
				capabilities,
				close: "manual",
			});
			active.session = session.id;
			run.session = session.id;
			try {
				if (active.controller.signal.aborted) throw new Error("Cron stopped");
				const result = await api.sessions.submit(session.id, { text: payload.text }, { wait: true });
				run.text = result.text;
				if (result.attachments) run.attachments = result.attachments;
				if (result.status !== "done") throw new Error(result.reason || result.status);
			} finally {
				await api.sessions.close(session.id);
			}
		} else {
			const command =
				payload.kind === "command" ? payload.command : [payload.interpreter, payload.path, ...(payload.args ?? [])];
			const result = await api.execution.run({
				owner: job.owner,
				capabilities,
				command,
				...(payload.cwd === undefined ? {} : { cwd: payload.cwd }),
				signal: active.controller.signal,
			});
			run.text = `${result.stdout}${result.stderr ? `\n[stderr]\n${result.stderr}` : ""}`;
			if (result.exitCode !== 0) throw new Error(`Command exited ${result.exitCode}`);
		}
		run.status = "done";
	} catch (error) {
		run.status = active.controller.signal.aborted ? "interrupted" : "run-failed";
		run.error = errorText(error);
	}
	if (job.delivery && !active.controller.signal.aborted) {
		try {
			const authority = await api.execution.resolve(job.owner);
			if (!job.capabilities.includes("message") || !authority.capabilities.includes("message"))
				throw new Error("Creator message capability revoked");
			checkDelivery(job.delivery, authority);
			const text = run.error ? `Cron ${job.name} failed: ${run.error}\n${run.text ?? ""}` : (run.text ?? "");
			const delivery = await api.messages.send({
				...job.delivery,
				owner: job.owner,
				text,
				...(run.attachments ? { attachments: run.attachments } : {}),
				signal: active.controller.signal,
			});
			if (!delivery.ok) throw new Error(delivery.error || "Delivery failed");
		} catch (error) {
			run.deliveryError = errorText(error);
			run.status = "delivery-failed";
		}
	}
	run.ended = new Date().toISOString();
	await writeRun(api, run);
	await emit({ type: `cron.${run.status}`, from: "plugin:cron", data: run });
	return run;
}
