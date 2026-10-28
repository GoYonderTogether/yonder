import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { type Attachment, type Capability, definePlugin, type ToolContext, type TSchema } from "@yonder/sdk";
import { renderPng, renderText, taskBoard } from "./board.js";
import { digest } from "./digest.js";
import { type Config, moments } from "./moments.js";
import { DONE, GET, LIST, NUDGE, NUDGE_INPUT, OPEN, SHOW, UPDATE } from "./prompts.js";
import { BoardService } from "./service.js";
import { type Open, Store, type Update } from "./store/index.js";

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
	configSchema: obj(
		{
			tailDigest: obj({ enabled: { type: "boolean" }, lines: { type: "integer", minimum: 1, maximum: 5 } }, []),
			stallMinutes: { type: "number", exclusiveMinimum: 0 },
			userWaitMinutes: { type: "number", exclusiveMinimum: 0 },
			moments: obj({ postCompact: { type: "boolean" }, postRetain: { type: "boolean" } }, []),
		},
		[],
	),
	setup(api) {
		const store = new Store(api.paths.data);
		const config = (api.config ?? {}) as Config;
		const service = new BoardService(store, api.locale, config.stallMinutes ?? 30, () => api.agents.list());
		api.triggers.register({ id: "tasks-board", start: () => service.start(), stop: () => service.stop() });
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
						return { text: JSON.stringify(await run(args as Record<string, unknown>, ctx)) };
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
		add("list", LIST, obj({}), ["read"], (_args, ctx) =>
			store.list(ctx).map((task) => ({
				...task,
				recentlyDone: config.moments?.postRetain === true && store.recentlyDone(task),
			})),
		);
		add("get", GET, obj({ id: string }), ["read"], (args, ctx) => store.get(args.id as string, ctx));
		add("nudge", NUDGE, obj({ id: string, say: string }), ["cross-agent"], async (args, ctx) => {
			const { task } = store.get(args.id as string, ctx);
			if (task.state === "done" || task.state === "cancelled") throw new Error("Task is closed");
			return api.sessions.submit(
				task.session,
				{
					text: NUDGE_INPUT(task.title, ctx.agent ?? `session:${ctx.session}`, args.say as string),
				},
				{ busy: "followup" },
			);
		});
		add(
			"show",
			SHOW,
			obj(
				{ target: { enum: ["channel", "json", "desktop", "web"] }, view: { enum: ["board", "detail"] }, id: string },
				[],
			),
			["read"],
			async (args, ctx) => {
				const target = args.target ?? "channel",
					view = args.view ?? "board";

				if (
					!["channel", "json", "desktop", "web"].includes(target as string) ||
					!["board", "detail"].includes(view as string)
				)
					throw new Error("Invalid target or view");
				if (view === "detail" && !args.id) throw new Error("detail requires id");
				const board = taskBoard(
					store.list(ctx),
					Date.now(),
					view === "detail" ? store.get(args.id as string, ctx) : undefined,
					config.stallMinutes ?? 30,
				);
				if (target === "json") return board;
				const source = service.publish(ctx);
				if (target === "desktop" || target === "web") {
					const endpoint = JSON.parse(await readFile(join(api.paths.data, "../interaction/renderer.json"), "utf8"));
					const response = await fetch(`${endpoint.url}board`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ source, id: view === "detail" ? args.id : undefined }),
						signal: ctx.signal,
					});
					if (!response.ok) throw new Error(await response.text());
					return response.json();
				}
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
				if (view === "board") {
					// The channel advertises its Attachment route beside its own private data.
					try {
						const instance = to.split(":")[1]!;
						const route = JSON.parse(
							await readFile(join(api.paths.data, "../channel-feishu", instance, "task-board.json"), "utf8"),
						);
						if (route.pid === process.pid) {
							const delivery = await api.messages.send({
								to,
								text: "",
								attachments: [{ kind: "file", mime: route.mime, uri: source }],
								signal: ctx.signal,
							});
							if (delivery.ok) return delivery;
						}
					} catch (error) {
						if ((error as NodeJS.ErrnoException).code !== "ENOENT")
							api.log.warn("Task board card unavailable; using image", { error: String(error) });
					}
				}
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

		api.contexts.register({ id: "tasks-turn", placement: "turn", render: (ctx) => store.render(ctx) });
		api.triggers.register(moments(api, store, config));
	},
});
