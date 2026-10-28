import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { definePlugin, type HostStatus, type PluginAPI, type ToolContext } from "@yonder/sdk";
import { Type } from "typebox";
import { Check } from "typebox/value";

/** Checklist order follows design §5.3: model first, then channels, gateway, credentials, plugins. */
export const ITEMS = ["model", "channels", "gateway", "credentials", "plugins"] as const;
export type Item = (typeof ITEMS)[number];

export interface State {
	/** Checklist item → task id in whichever task list the agent used (session todo or tasks ledger). */
	tasks: Partial<Record<Item, string>>;
	done?: string;
}

export interface CheckItem {
	id: Item;
	title: string;
	/** ok: nothing to do; todo: needs the owner; optional: available but not enabled. */
	state: "ok" | "todo" | "optional";
	detail: string;
	task?: string;
}

const conv = (agent: string) => `conv:onboarding:${agent}`;

/** Pure mapping from host facts to checklist items; the facts come from the kernel, not from this plugin. */
export function checklist(status: HostStatus, state: State): CheckItem[] {
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
	return items.map((item) => ({ ...item, ...(state.tasks[item.id] ? { task: state.tasks[item.id] } : {}) }));
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
	async write(agent: string, state: State): Promise<void> {
		await mkdir(this.directory, { recursive: true });
		const file = this.path(agent);
		await writeFile(`${file}.tmp`, JSON.stringify(state, null, 2));
		await rename(`${file}.tmp`, file);
	}
}

const recordSchema = Type.Union([
	Type.Object(
		{ item: Type.Union(ITEMS.map((id) => Type.Literal(id))), task: Type.String({ minLength: 1 }) },
		{ additionalProperties: false },
	),
	Type.Object({ done: Type.Literal(true) }, { additionalProperties: false }),
]);

function agentOf(ctx: ToolContext): string {
	if (!ctx.agent) throw new Error("onboarding tools run in an agent session");
	if (!ctx.capabilities.includes("admin")) throw new Error("onboarding tools require admin");
	return ctx.agent;
}

export default definePlugin({
	configSchema: Type.Object({ agent: Type.Optional(Type.String({ minLength: 1 })) }, { additionalProperties: false }),
	setup(api: PluginAPI) {
		const states = new StateFile(join(api.paths.data, "agents"));
		const agent = (api.config as { agent?: string } | undefined)?.agent ?? "main";
		api.skills.register("skills");
		api.triggers.register({
			id: "onboarding-start",
			// Wakes the butler on every start until onboarding.done; the recorded task ids make it resumable.
			async start(io) {
				const state = await states.read(agent);
				if (state.done) return;
				await io.emit({
					type: "onboarding.start",
					from: "plugin:onboarding",
					conv: conv(agent),
					data: { agent, resume: Object.keys(state.tasks).length > 0 },
				});
			},
			async stop() {},
		});
		api.tools.register({
			name: "onboarding_probe",
			description:
				"Read the onboarding checklist: each item's state from live host facts (model, channels, gateway, credentials, plugins), the task id already recorded for it, and whether onboarding is done. Read-only; never returns secret values.",
			parameters: Type.Object({}, { additionalProperties: false }),
			capabilities: ["read", "admin"],
			async execute(_input, ctx) {
				try {
					const id = agentOf(ctx);
					const state = await states.read(id);
					const items = checklist(await api.host.status(ctx), state);
					// needsTask makes the one-task-per-item rule explicit and lets a resumed run continue where it stopped.
					const needsTask = items.filter((item) => !item.task).map((item) => item.id);
					// The tool result carries the next step, so the checklist holds even when the skill file was not read.
					const next = state.done
						? "Onboarding is done."
						: needsTask.length
							? `Before messaging the owner, create one task per item in needsTask (session todo tool if available, else tasks_open with title "引导：<title>", objective = detail, acceptance ["主人确认"]) and call onboarding_record {item, task} for each; then close ok items with tasks_done and ask one question about the first open item.`
							: "All items have tasks; resume with the first item whose task is still open and ask one question.";
					return { text: JSON.stringify({ done: state.done ?? null, next, needsTask, items }) };
				} catch (error) {
					return { isError: true, text: error instanceof Error ? error.message : String(error) };
				}
			},
		});
		api.tools.register({
			name: "onboarding_record",
			description:
				"Record the task id you created for one checklist item ({item, task}), so a later run resumes instead of duplicating it; or mark onboarding finished ({done: true}), which appends the onboarding.done event.",
			parameters: recordSchema,
			capabilities: ["write", "admin"],
			async execute(input, ctx) {
				try {
					const id = agentOf(ctx);
					if (!ctx.capabilities.includes("write")) throw new Error("onboarding_record requires write");
					if (!Check(recordSchema, input)) throw new Error("Invalid onboarding_record parameters");
					const state = await states.read(id);
					if ("done" in input) {
						if (!state.done) {
							state.done = new Date().toISOString();
							await states.write(id, state);
							await api.events.emit({
								type: "onboarding.done",
								from: "plugin:onboarding",
								conv: conv(id),
								data: { agent: id, tasks: state.tasks },
							});
						}
					} else if (state.tasks[input.item as Item] !== input.task) {
						state.tasks[input.item as Item] = input.task;
						await states.write(id, state);
					}
					return { text: JSON.stringify(state) };
				} catch (error) {
					return { isError: true, text: error instanceof Error ? error.message : String(error) };
				}
			},
		});
	},
});
