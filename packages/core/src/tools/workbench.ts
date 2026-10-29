import type { AskResult, EventInput, SessionInfo, Tool, ToolContext } from "@yonder/sdk";
import { Type } from "typebox";
import type { AgentConfig } from "../config/index.js";
import { isConsoleBot } from "../kernel/console.js";
import type { Runtime } from "../runtime/index.js";
import type { Sessions } from "../sessions/index.js";
import type { Store } from "../store/index.js";
import { ownerIdentity } from "../store/sessions.js";
import { tool, withSignal } from "./helpers.js";
import { schema, text } from "./tool-schema.js";

type Code = "forbidden" | "not_found" | "invalid_params";
const reject = (code: Code, message: string) => new Error(`${code}: ${message}`);
const reply = (value: unknown) => ({ text: JSON.stringify(value) });

/**
 * Workbench tools (contracts §18). None of them is offered by default: `tools.offer` has to name them, so the
 * coding/task roles never see them. Each call re-checks who the caller is, because a Bot and the base session
 * get the same tool set.
 */
export function createWorkbenchTools({
	store,
	agents,
	sessions,
	ask,
	runtime,
}: {
	store: Store;
	agents: Map<string, AgentConfig>;
	sessions: Sessions;
	ask(input: EventInput): Promise<AskResult>;
	runtime: () => Runtime;
}): Tool[] {
	const current = async (ctx: ToolContext): Promise<SessionInfo> => {
		const session = await store.sessions.get(ctx.session);
		if (!session) throw reject("not_found", `未知会话：${ctx.session}`);
		return session;
	};
	const consoleBot = (bot: string) => {
		const agent = agents.get(bot);
		if (!agent || !isConsoleBot(agent)) throw reject("not_found", `未知 Bot：${bot}`);
	};
	const baseSession = (ctx: ToolContext) => {
		if (ctx.agent !== null) throw reject("forbidden", "只有基础会话（无人设）可以连接 Bot。");
	};
	const askBot = async (ctx: ToolContext, bot: string, payload: Record<string, unknown> & { text: string }) => {
		const answer = await withSignal(
			ask({
				type: "message.in",
				from: "acct:console:owner",
				conv: `conv:console:${bot}`,
				...(ctx.event ? { parent: ctx.event.id } : {}),
				data: { kind: "dm", target: bot, msgId: `internal:${runtime().invocationId(ctx)}`, ...payload },
			}),
			ctx.signal,
		);
		const result = answer.results.find((item) => item.agent === bot);
		if (!result) {
			const dropped = answer.event.routes?.find((route) => route.agent === bot)?.dropped;
			throw new Error(`Bot ${bot} did not accept the request (${dropped ?? "no route"})`);
		}
		return {
			text: result.text || result.reason || result.status,
			...(result.status === "done" ? {} : { isError: true }),
		};
	};
	return [
		tool({
			name: "session_archive",
			description:
				"把当前会话或自己名下的会话标为已完成（等同 sessions.archive）。Bot 只能归档自己名下的会话，其他会话只能归档自己。可选工具：默认不启用，需要时在 tools.offer 里写出名字。",
			parameters: schema({ id: Type.Optional(text()) }),
			execute: async (args, ctx) => {
				const target = (args as { id?: string }).id ?? ctx.session;
				const session = await store.sessions.get(target);
				if (!session) throw reject("not_found", `未知会话：${target}`);
				const owner = session.owner ?? ownerIdentity;
				const mine = owner.kind === "bot" && ctx.agent !== null && owner.id === ctx.agent;
				if (target !== ctx.session && !mine) throw reject("forbidden", "只能归档自己的会话，或自己名下 Bot 的会话。");
				await sessions.workbench.archive(target);
				return reply({ ok: true, session: target });
			},
		}),
		tool({
			name: "session_hand_up",
			description: "把当前 Bot 会话交回主人：设 needsOwner{reason} 并发通知，主人处理后再归档。可选工具：默认不启用。",
			parameters: schema({ reason: text() }),
			execute: async (args, ctx) => {
				const session = await current(ctx);
				const owner = session.owner ?? ownerIdentity;
				if (ctx.agent === null || owner.kind !== "bot" || owner.id !== ctx.agent)
					throw reject("forbidden", "只有 Bot 自己名下的会话可以交回主人。");
				const { reason } = args as { reason: string };
				await sessions.workbench.handUp(ctx.session, reason);
				return reply({ ok: true, needsOwner: { reason } });
			},
		}),
		tool({
			name: "bot_ask",
			description:
				"在基础会话里向某个 Bot 提问并拿回它的答复；不改变会话归属。可选工具：默认不启用，需要时在 tools.offer 里写出名字。",
			parameters: schema({ bot: text(), question: text() }),
			execute: async (args, ctx) => {
				baseSession(ctx);
				const { bot, question } = args as { bot: string; question: string };
				consoleBot(bot);
				return askBot(ctx, bot, { text: question });
			},
		}),
		tool({
			name: "bot_request",
			description:
				"在基础会话里向某个 Bot 申请或请它协助操作；由该 Bot 按自己的审批策略处理并返回结果。可选工具：默认不启用。",
			parameters: schema({ bot: text(), action: text(), detail: text() }),
			execute: async (args, ctx) => {
				baseSession(ctx);
				const { bot, action, detail } = args as { bot: string; action: string; detail: string };
				consoleBot(bot);
				return askBot(ctx, bot, { text: `${action}：${detail}`, request: { action, detail } });
			},
		}),
		tool({
			name: "bot_attach",
			description:
				"把当前基础会话挂到某个 Bot 下成为子会话（parent 设为该 Bot 的主会话），之后可以继续向它提问。基础会话本身就是主人的会话，所以视为已授权。可选工具：默认不启用。",
			parameters: schema({ bot: text() }),
			execute: async (args, ctx) => {
				baseSession(ctx);
				const { bot } = args as { bot: string };
				consoleBot(bot);
				const session = await current(ctx);
				if (session.parent) throw reject("invalid_params", "当前会话已经挂在别的会话下。");
				const main = (await store.sessions.list({ agent: bot, mode: "main", open: true }))[0];
				if (!main) throw reject("not_found", `Bot ${bot} 还没有主会话。`);
				await sessions.workbench.attach(ctx.session, main.id);
				return reply({ ok: true, parent: main.id });
			},
		}),
	];
}
