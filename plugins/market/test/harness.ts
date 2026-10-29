import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { PluginAPI, Tool, ToolContext, ToolResult, Trigger, ViewDecl, ViewProvider } from "@yonder/sdk";

export interface Call {
	method: string;
	path: string;
	query: URLSearchParams;
	body: unknown;
	authorization?: string;
}

export interface FakeCloud {
	base: string;
	calls: Call[];
	state: { checkItems: unknown[] };
	close(): Promise<void>;
}

const json = (value: unknown) => JSON.stringify(value ?? {});

/** 只监听回环的假云端：按契约 §19.4 的路径回应，并记录每次请求。 */
export async function fakeCloud(): Promise<FakeCloud> {
	const calls: Call[] = [];
	const state: { checkItems: unknown[] } = {
		checkItems: [{ id: "l9", title: "二手相机", price: 900, location: "上海" }],
	};
	const server = createServer(async (request, response) => {
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(chunk as Buffer);
		const raw = Buffer.concat(chunks).toString("utf8");
		const url = new URL(request.url ?? "/", "http://127.0.0.1");
		const method = request.method ?? "GET";
		const authorization = request.headers.authorization;
		calls.push({
			method,
			path: url.pathname,
			query: url.searchParams,
			body: raw ? JSON.parse(raw) : undefined,
			...(authorization ? { authorization } : {}),
		});
		const send = (status: number, value: unknown) => {
			response.writeHead(status, { "content-type": "application/json" });
			response.end(json(value));
		};
		const route = `${method} ${url.pathname}`;
		const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
		if (route === "GET /api/market/listings")
			return send(200, {
				items: [{ id: "l1", title: "相机", price: 1200, unit: "元", location: "上海" }],
				nextCursor: "next-1",
			});
		if (route === "GET /api/market/listings/missing") return send(404, { error: "not_found" });
		if (route === "GET /api/market/listings/l1") return send(200, { id: "l1", title: "相机", mine: true, price: 1200 });
		if (route === "GET /api/market/inquiries") return send(200, { items: [{ id: "q1", title: "相机", unread: 2 }] });
		if (route === "GET /api/market/inquiries/q1") return send(200, { id: "q1", title: "相机", messages: [] });
		if (route === "POST /api/market/listings/l1/inquiries") return send(200, { id: "q2", lastMessage: body.body });
		if (route === "POST /api/market/inquiries/q1/messages") return send(200, { id: "q1", lastMessage: body.body });
		if (route === "POST /api/market/listings") return send(200, { ...body, id: "l-new", status: "active" });
		if (route === "PATCH /api/market/listings/l1") return send(200, { ...body, id: "l1" });
		if (route === "POST /api/market/listings/l1/pause") return send(200, { id: "l1", status: "paused" });
		if (route === "POST /api/market/listings/l1/resume") return send(200, { id: "l1", status: "active" });
		if (route === "GET /api/market/watch-tasks")
			return send(200, {
				items: [{ id: "w1", title: "找相机", frequency: "hourly", active: true, checkedAt: Date.now() }],
			});
		if (route === "POST /api/market/watch-tasks")
			return send(200, { id: "w9", frequency: "daily", active: true, ...body });
		if (route === "PATCH /api/market/watch-tasks/w1")
			return send(200, { id: "w1", frequency: "hourly", active: true, ...body });
		if (route === "DELETE /api/market/watch-tasks/w1") return send(200, {});
		if (route === "POST /api/market/watch-tasks/w1/check") return send(200, { items: state.checkItems });
		return send(400, { error: "invalid_request" });
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
	const address = server.address() as AddressInfo;
	return {
		base: `http://127.0.0.1:${address.port}`,
		calls,
		state,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}

export interface Harness {
	api: PluginAPI;
	tools: Map<string, Tool>;
	views: Array<{ decl: ViewDecl; provider: ViewProvider }>;
	triggers: Trigger[];
	notifications: Array<{ session: string; text: string }>;
	run(name: string, args: unknown, agent?: string | null): Promise<ToolResult>;
}

/** 插件 API 的最小替身：只提供 market 插件用到的槽，其余抛错以便及早发现越界使用。 */
export function fakeApi(options: {
	data: string;
	config?: unknown;
	token?: string;
	/** 模拟主人尚未在云端登录：credentials.get 返回 undefined。 */
	signedOut?: boolean;
	sessions?: string[];
}): Harness {
	const tools = new Map<string, Tool>();
	const views: Array<{ decl: ViewDecl; provider: ViewProvider }> = [];
	const triggers: Trigger[] = [];
	const notifications: Array<{ session: string; text: string }> = [];
	const forbidden = (name: string) => () => {
		throw new Error(`market test harness: ${name} is not available`);
	};
	const api = {
		id: "market",
		version: "0.0.0-test",
		locale: "zh-CN",
		timezone: "Asia/Shanghai",
		config: options.config,
		log: { info: () => {}, warn: () => {}, error: () => {} },
		paths: { data: options.data },
		tools: { register: (tool: Tool) => tools.set(tool.name, tool) },
		views: { register: (decl: ViewDecl, provider: ViewProvider) => views.push({ decl, provider }) },
		triggers: { register: (trigger: Trigger) => triggers.push(trigger) },
		credentials: {
			get: async () => (options.signedOut ? undefined : { type: "api_key", key: options.token ?? "device-token" }),
		},
		sessions: {
			list: async () => (options.sessions ?? ["1"]).map((id) => ({ id, agent: "main", mode: "main" })),
			notify: async (session: string, input: { text: string }) => {
				notifications.push({ session, text: input.text });
				return { session, event: "market.watch-matches", entry: 1, recorded: true as const };
			},
		},
		permissions: { register: forbidden("permissions.register") },
		agents: { list: forbidden("agents.list") },
		channels: { register: forbidden("channels.register") },
		contexts: { register: forbidden("contexts.register") },
		envs: { register: forbidden("envs.register") },
		hooks: { register: forbidden("hooks.register") },
		presets: { register: forbidden("presets.register") },
		skills: { register: forbidden("skills.register") },
		events: { on: forbidden("events.on"), emit: forbidden("events.emit") },
		messages: { send: forbidden("messages.send") },
		execution: { resolve: forbidden("execution.resolve") },
		subagents: { run: forbidden("subagents.run") },
		identity: { account: forbidden("identity.account") },
		services: { resolve: forbidden("services.resolve") },
		host: { status: forbidden("host.status") },
	};
	const run = async (name: string, args: unknown, agent: string | null = "main"): Promise<ToolResult> => {
		const tool = tools.get(`market_${name}`);
		if (!tool) throw new Error(`market_${name} is not registered`);
		const ctx = {
			agent,
			profile: "default",
			session: "1",
			capabilities: ["network"],
			env: "local",
			signal: new AbortController().signal,
		} as unknown as ToolContext;
		return tool.execute(args, ctx);
	};
	return { api: api as unknown as PluginAPI, tools, views, triggers, notifications, run };
}
