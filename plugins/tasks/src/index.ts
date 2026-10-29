import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
	type Attachment,
	type Capability,
	definePlugin,
	type Hook,
	type Message,
	type PluginAPI,
	type ToolContext,
	type TSchema,
} from "@yonder/sdk";
import { renderPng, renderText, taskBoard } from "./board.js";
import { digest } from "./digest.js";
import { type Config, moments, stallWindow } from "./moments.js";
import { DONE, GET, LIST, OPEN, SHOW, UPDATE } from "./prompts.js";
import { type AuditResult, type Open, Store, type Task, type Update, type UpdateItem } from "./store/index.js";
import { ongoing, own } from "./store/project.js";
import { auditPrompt, budgetReached, parseAuditVerdict, registerTaskViews } from "./views.js";

const string = { type: "string", minLength: 1, pattern: "[\\s\\S]*\\S[\\s\\S]*" };
const strings = { type: "array", items: string };
const obj = (properties: Record<string, TSchema>, required = Object.keys(properties)): TSchema =>
	({ type: "object", properties, required, additionalProperties: false }) as TSchema;
const content = {
	title: string,
	objective: string,
	acceptance: { ...strings, minItems: 2, maxItems: 5 },
	nonGoals: strings,
	budget: obj(
		{
			wallMinutes: { type: "number", exclusiveMinimum: 0 },
			wakeups: { type: "integer", minimum: 1 },
			// 生命周期 token 上限：触顶只注入一次收尾提示，任务不会因此关闭。
			tokens: { type: "integer", minimum: 1 },
		},
		[],
	),
	contract: string,
	lightweight: { type: "boolean" },
	parent: string,
};
const change = {
	id: string,
	...content,
	state: { enum: ["active", "waiting-user", "blocked", "review", "cancelled"] },
	deliverable: string,
	note: string,
};
/** 完成审计：另开一个只读会话复核，末行 `<approved/>` 才算通过；审计的不是被审计的会话，所以不会死等自己。 */
async function auditCompletion(
	api: PluginAPI,
	config: Config,
	ctx: ToolContext,
	task: Task,
	deliverable: string,
	evidence: string[],
): Promise<Omit<AuditResult, "at">> {
	const preset = config.audit?.preset ?? "default";
	const auditor = await api.sessions.open({
		preset,
		// 模型源必须是带主 Agent 的普通会话：预设会话和任务会话都用不了。
		...(ctx.agent ? { modelSource: { session: ctx.session } } : {}),
		capabilities: ["read"],
		close: "run-end",
	});
	try {
		const run = await api.sessions.submit(
			auditor.id,
			{ text: auditPrompt(task, deliverable, evidence) },
			{ wait: true },
		);
		if (run.status !== "done")
			return {
				verdict: "rejected",
				reason: `the auditor run ended as ${run.status}${run.reason ? `: ${run.reason}` : ""}`,
				preset,
				session: auditor.id,
			};
		return { ...parseAuditVerdict(run.text), preset, session: auditor.id };
	} finally {
		await api.sessions
			.close(auditor.id)
			.catch((error: unknown) => api.log.warn("Audit session close failed", { error: String(error) }));
	}
}

/** 每轮请求前按会话累计 token 结算一次；触顶只注入一次收尾提示。 */
function budgetHook(store: Store): Hook {
	return {
		id: "tasks-budget",
		async beforeRequest(messages, ctx) {
			const tasks = store.list(ctx).filter((task) => own(task, ctx) && ongoing(task) && task.budget.tokens);
			if (!tasks.length) return undefined;
			const spent = messages.reduce(
				(sum, message) => (message.role === "assistant" ? sum + message.usage.input + message.usage.output : sum),
				0,
			);
			const notes: string[] = [];
			for (const task of tasks) {
				const reached = spent >= (task.budget.tokens ?? 0) && !task.budget.warned;
				const charged = store.spend(task.id, spent, reached);
				if (reached && charged) notes.push(budgetReached(charged, spent));
			}
			if (!notes.length) return undefined;
			return { messages: [...messages, { role: "user", content: notes.join("\n\n"), timestamp: Date.now() }] };
		},
	};
}

export default definePlugin({
	configSchema: obj(
		{
			tailDigest: obj({ enabled: { type: "boolean" }, lines: { type: "integer", minimum: 1, maximum: 5 } }, []),
			stallMinutes: { type: "number", minimum: 15, maximum: 30 },
			userWaitMinutes: { type: "number", exclusiveMinimum: 0 },
			moments: obj({ postCompact: { type: "boolean" }, postRetain: { type: "boolean" } }, []),
			audit: obj({ enabled: { type: "boolean" }, preset: string }, []),
		},
		[],
	),
	setup(api) {
		const store = new Store(api.paths.data);
		registerTaskViews(api, store);
		const config = (api.config ?? {}) as Config;
		api.triggers.register({
			id: "tasks-board",
			start: async () => {},
			stop: async () => store.close(),
		});
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
						const result = await run(args as Record<string, unknown>, ctx);
						if (["open", "update", "done"].includes(name)) api.invalidate(["tasks.board"]);
						return { text: JSON.stringify(result) };
					} catch (error) {
						return { text: error instanceof Error ? error.message : String(error), isError: true };
					}
				},
			});
		add(
			"open",
			OPEN,
			obj({ ...content, origin: string }, ["title", "objective", "acceptance", "nonGoals"]),
			["write"],
			// SAFETY: typebox 已按 Open 校验参数，这里只需把校验过的对象交给存储层。
			(args, ctx) => store.open(args as unknown as Open, ctx),
		);
		add(
			"update",
			UPDATE,
			obj(
				{
					...change,
					// 一批有序更新共用一个事务；给了 updates 就不再接受顶层 id。
					updates: { type: "array", minItems: 1, maxItems: 100, items: obj(change, ["id"]) },
				},
				[],
			),
			["write"],
			(args, ctx) => {
				const { id, updates, ...patch } = args as { id?: string; updates?: UpdateItem[] };
				if (updates) {
					if (id) throw new Error("Pass either id or updates, not both");
					return store.updateMany(updates, ctx);
				}
				if (!id) throw new Error("update requires id or updates");
				return store.update(id, patch as Update, ctx);
			},
		);
		add(
			"done",
			DONE,
			obj({ id: string, deliverable: string, evidence: { ...strings, minItems: 2, maxItems: 5 } }),
			["write"],
			async (args, ctx) => {
				const id = args.id as string,
					deliverable = args.deliverable as string,
					evidence = args.evidence as string[];
				// 先审后关：审计员只看任务契约和这次交的证据，通过才真的关闭。
				if (config.audit?.enabled !== false) {
					const task = store.get(id, ctx).task;
					const result = await auditCompletion(api, config, ctx, task, deliverable, evidence);
					store.recordAudit(task.id, result);
					if (result.verdict !== "approved")
						throw new Error(`An independent auditor rejected this completion: ${result.reason}`);
				}
				return store.done(id, deliverable, evidence, ctx);
			},
		);
		add("list", LIST, obj({}), ["read"], (_args, ctx) =>
			store.list(ctx).map((task) => ({
				...task,
				recentlyDone: config.moments?.postRetain === true && store.recentlyDone(task),
			})),
		);
		add("get", GET, obj({ id: string }), ["read"], (args, ctx) => store.get(args.id as string, ctx));
		add(
			"show",
			SHOW,
			obj({ target: { enum: ["channel", "json"] }, view: { enum: ["board", "detail"] }, id: string }, []),
			["read"],
			async (args, ctx) => {
				const target = args.target ?? "channel",
					view = args.view ?? "board";

				if (!["channel", "json"].includes(target as string) || !["board", "detail"].includes(view as string))
					throw new Error("Invalid target or view");
				if (view === "detail" && !args.id) throw new Error("detail requires id");
				const board = taskBoard(
					store.list(ctx),
					Date.now(),
					view === "detail" ? store.get(args.id as string, ctx) : undefined,
					stallWindow(config.stallMinutes),
				);
				if (target === "json") return board;
				let to = ctx.events?.findLast((event) => event.conv)?.conv ?? ctx.event?.conv;
				if (!to) {
					let after: string | undefined;
					do {
						const page = await api.events.query({ type: "message.in", limit: 1000, ...(after ? { after } : {}) });
						to =
							page.events.findLast(
								(event) => event.conv && event.routes?.some((route) => route.session === ctx.session),
							)?.conv ?? to;
						after = page.next;
					} while (after);
				}
				if (!to) throw new Error("No channel conversation in the calling session");
				let attachments: Attachment[] | undefined;
				let text = "";
				try {
					const bytes = await renderPng(board, api.locale);
					await mkdir(api.paths.data, { recursive: true });
					const name = `tasks-${randomUUID()}.png`,
						path = join(api.paths.data, name);
					await writeFile(path, bytes);
					attachments = [
						{ kind: "image" as const, mime: "image/png", uri: pathToFileURL(path).href, name, bytes: bytes.length },
					];
				} catch (error) {
					api.log.warn("Task image unavailable; using text", { error: String(error) });
					text = renderText(board, api.locale);
				}
				return api.messages.send({ to, text, ...(attachments ? { attachments } : {}), signal: ctx.signal });
			},
		);
		api.hooks.register(digest(api, store, config));
		api.hooks.register(budgetHook(store));

		api.contexts.register({ id: "tasks-turn", placement: "turn", render: (ctx) => store.render(ctx) });
		api.triggers.register(moments(api, store, config));
	},
});
