import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { definePlugin, type HostStatus, type PluginAPI, type ToolContext } from "@yonder/sdk";
import { Type } from "typebox";
import { Check } from "typebox/value";

/** Checklist order follows design §5.3: model first, then channels, gateway, credentials, plugins. */
export const ITEMS = ["model", "channels", "gateway", "credentials", "plugins"] as const;
export type Item = (typeof ITEMS)[number];

/** Where a checklist task lives: the session `todo` list of `session`, or the tasks plugin ledger. */
export interface TaskRef {
	id: string;
	list: "todo" | "tasks";
	session?: string;
}

export interface State {
	tasks: Partial<Record<Item, TaskRef>>;
	done?: string;
	/** The owner declined onboarding; no more wakes. */
	dismissed?: string;
	/** Wake attempts so far and the last one, bounding retries when runs fail (design §5.3). */
	wakes?: number;
	lastWake?: string;
}

/** At most one wake per day and five in total, so a failing model cannot loop on every start. */
export const WAKE_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const MAX_WAKES = 5;

export function shouldWake(state: State, now: number, enabled: boolean, modelReady: boolean): boolean {
	if (!enabled || state.done || state.dismissed || !modelReady) return false;
	if ((state.wakes ?? 0) >= MAX_WAKES) return false;
	return !state.lastWake || now - Date.parse(state.lastWake) >= WAKE_INTERVAL_MS;
}

export interface CheckItem {
	id: Item;
	title: string;
	/** ok: nothing to do; todo: needs the owner; optional: available but not enabled. */
	state: "ok" | "todo" | "optional";
	detail: string;
	task?: TaskRef;
}

const conv = (agent: string) => `conv:onboarding:${agent}`;

/** Pure mapping from host facts to checklist items; the facts come from the kernel, not from this plugin. */
export function checklist(status: HostStatus, state: Pick<State, "tasks">): CheckItem[] {
	const model = status.model.known && status.model.authConfigured;
	const credentials = status.credentials.filter((item) => item.configured);
	const items: Omit<CheckItem, "task">[] = [
		{
			id: "model",
			title: "确认模型可用",
			state: model ? "ok" : "todo",
			detail: `当前会话模型 ${status.model.session}${status.model.default ? `，默认模型 ${status.model.default}` : ""}；${
				!status.model.known ? "模型不在已知列表" : status.model.authConfigured ? "凭据已配置" : "缺少凭据"
			}`,
		},
		{
			id: "channels",
			title: "选择要启用的渠道",
			state: status.shippedChannels.length ? "optional" : "ok",
			detail: `已启用：${status.channels.map((item) => `${item.instance}(${item.type})`).join("、") || "无"}；随包未启用：${
				status.shippedChannels.map((item) => item.type).join("、") || "无"
			}`,
		},
		{
			id: "gateway",
			title: "确认 Web 控制台网关",
			state: status.gateway.enabled ? "ok" : "optional",
			detail: status.gateway.enabled
				? `已启用${status.gateway.port === undefined ? "（默认端口）" : `，端口 ${status.gateway.port}`}`
				: "已关闭（gateway.enabled: false）",
		},
		{
			id: "credentials",
			title: "检查凭据",
			state: credentials.length ? "ok" : "todo",
			detail: credentials.length
				? `已配置：${credentials.map((item) => `${item.provider}/${item.slot}`).join("、")}`
				: "没有已配置的凭据槽",
		},
		{
			id: "plugins",
			title: "了解已加载的插件",
			state: "ok",
			detail: `已加载：${status.plugins.map((item) => item.id).join("、") || "无"}`,
		},
	];
	return items.map((item) => {
		const task = state.tasks[item.id];
		return task ? { ...item, task } : item;
	});
}

export class StateFile {
	constructor(private directory: string) {}
	private path(agent: string) {
		if (!/^[a-z0-9][a-z0-9-]*$/.test(agent)) throw new Error(`Invalid agent id: ${agent}`);
		return join(this.directory, `${agent}.json`);
	}
	async read(agent: string): Promise<State> {
		try {
			return { tasks: {}, ...JSON.parse(await readFile(this.path(agent), "utf8")) };
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return { tasks: {} };
			throw error;
		}
	}
	private queue: Promise<unknown> = Promise.resolve();
	/** Serialized read-modify-write; the kernel's home lock already keeps this to one process. */
	update(agent: string, change: (state: State) => State | undefined): Promise<State> {
		const next = this.queue.then(async () => {
			const current = await this.read(agent);
			const changed = change(current);
			if (changed) await this.write(agent, changed);
			return changed ?? current;
		});
		this.queue = next.catch(() => undefined);
		return next;
	}
	async write(agent: string, state: State): Promise<void> {
		await mkdir(this.directory, { recursive: true });
		const file = this.path(agent);
		await writeFile(`${file}.tmp`, JSON.stringify(state, null, 2));
		await rename(`${file}.tmp`, file);
	}
}

const recordSchema = Type.Union([
	Type.Object(
		{
			item: Type.Union(ITEMS.map((id) => Type.Literal(id))),
			task: Type.String({ minLength: 1 }),
			list: Type.Union([Type.Literal("todo"), Type.Literal("tasks")]),
		},
		{ additionalProperties: false },
	),
	Type.Object({ done: Type.Literal(true) }, { additionalProperties: false }),
	Type.Object({ dismissed: Type.Literal(true) }, { additionalProperties: false }),
]);

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Latest session todo list per session, from the kernel's `todo.updated` events (contracts §3.4). */
async function todoLists(api: PluginAPI, agent: string): Promise<Map<string, Map<string, string>>> {
	const lists = new Map<string, Map<string, string>>();
	let after: string | undefined;
	for (;;) {
		const page = await api.events.query({
			type: "todo.updated",
			from: `agent:${agent}`,
			limit: 500,
			...(after ? { after } : {}),
		});
		for (const event of page.events) {
			const data = event.data as { session: string; items: Array<{ id: string; state: string }> };
			lists.set(data.session, new Map(data.items.map((item) => [item.id, item.state])));
		}
		if (!page.next || !page.events.length) return lists;
		after = page.next;
	}
}

/** A recorded todo task is gone when its session list no longer has it or it was deleted. Ledger ids are checked by the agent (tasks_get). */
export function missingTodo(task: TaskRef, lists: Map<string, Map<string, string>>): boolean {
	if (task.list !== "todo") return false;
	const state = lists.get(task.session ?? "")?.get(task.id);
	return !state || state === "cancelled";
}

export default definePlugin({
	configSchema: Type.Object(
		{ agent: Type.Optional(Type.String({ minLength: 1 })), enabled: Type.Optional(Type.Boolean()) },
		{ additionalProperties: false },
	),
	setup(api: PluginAPI) {
		const states = new StateFile(join(api.paths.data, "agents"));
		const config = (api.config ?? {}) as { agent?: string; enabled?: boolean };
		const agent = config.agent ?? "main";
		const enabled = config.enabled !== false;
		/** The tools serve the configured butler only; the state key and conv are always that agent's. */
		const caller = (ctx: ToolContext) => {
			if (ctx.agent !== agent) throw new Error(`onboarding tools belong to agent ${agent}`);
			if (!ctx.capabilities.includes("admin")) throw new Error("onboarding tools require admin");
		};
		api.skills.register("skills");
		api.triggers.register({
			id: "onboarding-start",
			async start(io) {
				const ready = enabled && (await api.host.modelReady(agent));
				let wake = false;
				const state = await states.update(agent, (current) => {
					wake = shouldWake(current, Date.now(), enabled, ready);
					return wake ? { ...current, wakes: (current.wakes ?? 0) + 1, lastWake: new Date().toISOString() } : undefined;
				});
				if (!wake) return;
				await io.emit({
					type: "onboarding.start",
					from: "plugin:onboarding",
					conv: conv(agent),
					data: { agent, resume: Object.keys(state.tasks).length > 0, attempt: state.wakes },
				});
			},
			async stop() {},
		});
		api.tools.register({
			name: "onboarding_probe",
			description:
				"Read the onboarding checklist: each item's state from live host facts (model, channels, gateway, credentials, plugins), the task already recorded for it, and whether onboarding is done. Read-only; never returns secret values.",
			parameters: Type.Object({}, { additionalProperties: false }),
			capabilities: ["read", "admin"],
			async execute(_input, ctx) {
				try {
					caller(ctx);
					const state = await states.read(agent);
					const lists = await todoLists(api, agent);
					const items = checklist(await api.host.status(ctx), state);
					// A recorded todo task that disappeared needs a new one; ledger tasks are verified with tasks_get.
					const needsTask = items.filter((item) => !item.task || missingTodo(item.task, lists)).map((item) => item.id);
					const next =
						state.done || state.dismissed
							? "Onboarding is finished or dismissed; do nothing."
							: needsTask.length
								? `Before messaging the owner, create one task per item in needsTask (the session todo tool if available, else tasks_open with title "引导：<title>", objective = detail, acceptance ["主人确认"]) and call onboarding_record {item, task, list} for each; then complete ok items and ask one question about the first open item.`
								: "All items have tasks; resume with the first item whose task is still open (tasks_get for ledger tasks) and ask one question.";
					return {
						text: JSON.stringify({
							done: state.done ?? null,
							dismissed: state.dismissed ?? null,
							next,
							needsTask,
							items,
						}),
					};
				} catch (error) {
					return { isError: true, text: message(error) };
				}
			},
		});
		api.tools.register({
			name: "onboarding_record",
			description:
				'Record the task you created for one checklist item ({item, task, list: "todo"|"tasks"}) so a later run resumes instead of duplicating it; mark onboarding finished ({done: true}, appends onboarding.done); or record that the owner declined it ({dismissed: true}), which stops further wakes.',
			parameters: recordSchema,
			capabilities: ["write", "admin"],
			async execute(input, ctx) {
				try {
					caller(ctx);
					if (!ctx.capabilities.includes("write")) throw new Error("onboarding_record requires write");
					if (!Check(recordSchema, input)) throw new Error("Invalid onboarding_record parameters");
					let finished = false;
					const now = new Date().toISOString();
					const state = await states.update(agent, (current) => {
						if ("done" in input) {
							if (current.done) return undefined;
							finished = true;
							return { ...current, done: now };
						}
						if ("dismissed" in input) return current.dismissed ? undefined : { ...current, dismissed: now };
						const task: TaskRef = {
							id: input.task,
							list: input.list,
							...(input.list === "todo" ? { session: ctx.session } : {}),
						};
						const item = input.item as Item;
						const old = current.tasks[item];
						if (old && old.id === task.id && old.list === task.list && old.session === task.session) return undefined;
						return { ...current, tasks: { ...current.tasks, [item]: task } };
					});
					if (finished)
						await api.events.emit({
							type: "onboarding.done",
							from: "plugin:onboarding",
							conv: conv(agent),
							data: { agent, tasks: state.tasks },
						});
					return { text: JSON.stringify(state) };
				} catch (error) {
					return { isError: true, text: message(error) };
				}
			},
		});
	},
});
