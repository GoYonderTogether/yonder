import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT as C } from "@earendil-works/chord/context";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { LiveDoc } from "@earendil-works/pi-durable";
import type { Attachment, YEvent } from "@yonder/sdk";
import { mergeCredentialSlots } from "../config/index.js";
import { validateSlotPart } from "./credential-slots.js";
import { cid, RunDoc, type RunState, SessionDoc } from "./docs.js";
import { requestedEffort, resolveEffort } from "./effort.js";
import { inputContent } from "./input-content.js";
import type { RuntimeInternals } from "./instance.js";
import { entryText as textOf } from "./transcript.js";
import type { RuntimeSessionConfig } from "./types.js";

export function currentConfig(rt: RuntimeInternals, id: string): RuntimeSessionConfig | undefined {
	return rt.configured.get(id);
}
export async function sessionConfig(rt: RuntimeInternals, id: string): Promise<RuntimeSessionConfig> {
	const live = await rt.harness.snapshot(LiveDoc, cid(id), C);
	return (live?.run ? rt.currentConfig(id) : undefined) ?? rt.options.resolveSession(id);
}
export async function prepareRun(rt: RuntimeInternals, session: string, context: Context): Promise<void> {
	await rt.restartNotes;
	const live = await rt.harness.snapshot(LiveDoc, cid(session), context);
	if (!live?.run) return;
	const id = String(live.run.inputs[0]);
	const active = rt.limits.states.get(id);
	if (active) {
		if (!rt.restoring) await rt.preparePlacedInputs(session, active.config, active.started, context);
		return;
	}
	const saved = await rt.harness.snapshot(RunDoc, cid(session), id, context);
	// beforeAgent is actual execution, unlike admission into the inbox. Also runs
	// for a genuinely live recovered run, never for a historical receipt.
	await rt.harness.commit(async (tx) => {
		const activity = await tx.doc(SessionDoc, cid(session));
		activity.activityRunId = id;
		activity.activityIssue = null;
	}, context);
	const started = saved?.started || Date.now();
	const config: RuntimeSessionConfig = saved?.config
		? JSON.parse(saved.config)
		: structuredClone(await rt.options.resolveSession(session));
	const usageBefore = saved?.config ? saved.usageBefore : await rt.usage(session);
	if (!saved?.config) await rt.applyRequestedEffort(session, config, context);
	await rt.modelsFor(config);
	await rt.applyConfiguration(session, config);
	if (!saved?.config) {
		await rt.harness.commit(async (tx) => {
			Object.assign(await tx.doc(RunDoc, cid(session), id, null), {
				config: JSON.stringify(config),
				started,
				usageBefore,
			});
		}, context);
	}
	rt.configured.set(session, config);
	const state: RunState = {
		visibility: new AbortController(),
		id,
		session,
		config,
		started,
		lastToolAt: saved?.config ? Date.now() : started,
		warnings: new Set(saved?.warnings ?? []),
		usageBefore,
		toolTasks: [...(saved?.toolTasks ?? [])],
		turns: saved?.turns ?? 0,
		repeats: saved?.repeats ?? 0,
		...(saved?.previous ? { previous: JSON.parse(saved.previous) } : {}),
		...(saved?.reason ? { reason: saved.reason } : {}),
		...(saved?.error ? { error: saved.error } : {}),
		timer: undefined,
		deadline: started + config.resolved.limits.maxMinutes * 60000,
	};
	if (!rt.restoring) rt.limits.arm(state);
	rt.limits.states.set(id, state);
	if (!rt.restoring) await rt.preparePlacedInputs(session, config, started, context);
}
/** Per-run effort from authorized delegations; changes only this run's snapshot, never the profile or session. */
export async function applyRequestedEffort(
	rt: RuntimeInternals,
	session: string,
	config: RuntimeSessionConfig,
	context: Context,
): Promise<void> {
	const view = await (await rt.conversation(session)).context(context);
	const prepared = new Set(
		view.entries
			.filter((entry) => entry.kind === "yonder.prepared")
			.map((entry) => (entry.data as { target: number }).target),
	);
	const events: YEvent[] = [];
	for (const entry of view.entries) {
		const data = entry.data as { raw?: boolean; event?: string } | undefined;
		if (entry.kind !== "yonder.message" || !data?.raw || !data.event || prepared.has(entry.id)) continue;
		const event = await rt.options.readEvent?.(data.event);
		if (event) events.push(event);
	}
	const overrides = events
		.filter(
			(event) =>
				event.type === "session.input" &&
				event.from?.startsWith("agent:") &&
				(event.data as { taskOwned?: boolean }).taskOwned === true,
		)
		.map((event) => (event.data as { credentialSlots?: Record<string, string> }).credentialSlots)
		.filter((value) => value !== undefined);
	for (const override of overrides) {
		if (!override || typeof override !== "object" || Array.isArray(override))
			throw new Error("Invalid credential slot override");
		for (const [provider, slot] of Object.entries(override)) {
			validateSlotPart(provider);
			validateSlotPart(slot);
		}
	}
	config.resolved.credentialSlots = mergeCredentialSlots(config.resolved.credentialSlots, ...overrides);
	const asked = requestedEffort(events);
	if (!asked) return;
	const slash = config.resolved.model.indexOf("/");
	const model = (await rt.modelsFor(config)).getModel(
		config.resolved.model.slice(0, slash),
		config.resolved.model.slice(slash + 1),
	);
	try {
		if (!model) throw new Error("Unknown model");
		const resolution = resolveEffort(model, config.resolved.thinking as ModelThinkingLevel, asked.requested, true);
		config.resolved = { ...config.resolved, thinking: resolution.effective };
		config.effort = {
			requested: asked.requested,
			effective: resolution.effective,
			...(resolution.fallbackReason ? { reason: resolution.fallbackReason } : {}),
			inputs: asked.inputs,
		};
	} catch {
		config.effort = {
			requested: asked.requested,
			effective: config.resolved.thinking,
			reason: "model-without-effort",
			inputs: asked.inputs,
		};
	}
}
export async function preparePlacedInputs(
	rt: RuntimeInternals,
	session: string,
	config: RuntimeSessionConfig,
	started: number,
	context: Context,
): Promise<void> {
	const conversation = await rt.conversation(session);
	let view = await conversation.context(context);
	const prepared = new Set(
		view.entries
			.filter((entry) => entry.kind === "yonder.prepared")
			.map((entry) => (entry.data as { target: number }).target),
	);
	for (const entry of view.entries) {
		const data = entry.data as
			| { raw?: boolean; event?: string; wake?: "run" | "write"; attachments?: Attachment[] }
			| undefined;
		if (entry.kind !== "yonder.message" || !data?.raw || prepared.has(entry.id)) continue;
		const event = data.event ? await rt.options.readEvent?.(data.event) : undefined;
		if (data.event && !event) throw new Error(`Missing input event: ${data.event}`);
		const input =
			event && rt.options.prepareInput
				? await rt.options.prepareInput(session, event, config, data.wake ?? "run", context.abortSignal)
				: { text: textOf(entry), ...(event ? { event } : {}), attachments: data.attachments ?? [] };
		if (data.wake !== "write") {
			const now = Date.now();
			input.text = `<runtime_clock utc="${new Date(now).toISOString()}">Elapsed ${Math.round((now - started) / 1000)} seconds at input preparation. Time/turn/token thresholds are reminders; explicit cancellation and real provider limits remain effective.</runtime_clock>\n\n${input.text}`;
		}
		const slash = config.resolved.model.indexOf("/");
		const model = (await rt.modelsFor(config)).getModel(
			config.resolved.model.slice(0, slash),
			config.resolved.model.slice(slash + 1),
		);
		const images = view.messages.flatMap((message) =>
			Array.isArray(message.content) ? message.content.filter((block) => block.type === "image") : [],
		).length;
		const content = await inputContent(
			config,
			input,
			context,
			(model?.inputLimits?.images?.maxPerRequest ?? Infinity) - images,
			(model?.inputLimits?.maxRequestBytes ?? Infinity) - Buffer.byteLength(JSON.stringify(view.messages)),
			(config) => rt.environment(config),
			(config) => rt.modelsFor(config),
			() => rt.imageProcessor(),
		);
		await rt.harness.commit(async (tx) => {
			await tx.appendEntry(cid(session), {
				kind: "yonder.prepared",
				data: JSON.parse(
					JSON.stringify({
						target: entry.id,
						event: data.event,
						attachments:
							(input.event?.data as { attachments?: Attachment[] } | undefined)?.attachments ?? input.attachments ?? [],
					}),
				),
				edits: [{ target: entry.id, action: "replace", messages: [{ role: "user", content, timestamp: Date.now() }] }],
			});
		}, context);
		await rt.options.onAdmitted?.(session, input);
		view = await conversation.context(context);
	}
}
