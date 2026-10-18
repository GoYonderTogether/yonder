// Protocol/config behavior informed by OpenClaw (MIT), commit
// cafa09e50556e08c2a04a670f16ac815482c5489, extensions/codex/src/app-server/
// {web-search,bounded-turn,thread-requests}.ts; implemented against local official schema.
import type { ToolResult } from "@yonder/sdk";
import { type AppServer, type RecordValue, record } from "./app-server.js";

const disabledFeatures = [
	"apps",
	"artifact",
	"browser_use",
	"browser_use_external",
	"code_mode",
	"code_mode_only",
	"computer_use",
	"context_management",
	"deferred_executor",
	"goals",
	"hooks",
	"image_generation",
	"memories",
	"multi_agent",
	"multi_agent_v2",
	"plugins",
	"request_permissions_tool",
	"shell_tool",
	"skill_search",
	"standalone_web_search",
	"unified_exec",
	"view_image",
	"workspace_dependencies",
];
export function searchConfig(names: string[]): RecordValue {
	if (names.some((name) => !/^[a-zA-Z0-9_-]+$/.test(name)))
		throw new Error("Cannot safely disable MCP server name with config path separators");
	return {
		...Object.fromEntries(disabledFeatures.map((name) => [`features.${name}`, false])),
		"agents.enabled": false,
		"skills.include_instructions": false,
		include_environment_context: false,
		project_doc_max_bytes: 0,
		web_search: "live",
		"orchestrator.mcp.enabled": false,
		"orchestrator.skills.enabled": false,
		"skills.bundled.enabled": false,
		...Object.fromEntries(names.map((name) => [`mcp_servers.${name}.enabled`, false])),
	};
}
export function searchResult(
	model: string,
	thread: string,
	turn: string,
	status: unknown,
	items: RecordValue[],
): ToolResult {
	if (status !== "completed") throw new Error(`Hosted search ended with status ${String(status)}`);
	if (items.some((item) => !["userMessage", "agentMessage", "webSearch", "reasoning"].includes(String(item.type))))
		throw new Error("Hosted search used a non-search item");
	const searches = items.filter((item) => item.type === "webSearch");
	const sources = searches.flatMap((item) =>
		Array.isArray(item.results)
			? item.results
					.map(record)
					.filter((result) => typeof result.url === "string")
					.map((result) => result.url as string)
			: [],
	);
	const answer = items
		.filter((item) => item.type === "agentMessage")
		.map((item) => (typeof item.text === "string" ? item.text : ""))
		.join("\n\n");
	if (!searches.length || !sources.length || !answer.trim())
		throw new Error("Hosted search missing native webSearch, source URLs, or answer");
	return {
		text: JSON.stringify({
			provider: "codex",
			model,
			thread,
			turn,
			externalContent: { untrusted: true, source: "native hosted webSearch" },
			searches,
			sources,
			answer,
		}),
	};
}
export async function hostedSearch(client: AppServer, query: string, signal: AbortSignal): Promise<ToolResult> {
	let thread: string | undefined;
	let turn = "";
	let release = () => {};
	let interrupt: Promise<unknown> | undefined;
	const stop = () => {
		if (thread)
			interrupt ??= client
				.request("turn/interrupt", { threadId: thread, turnId: turn }, AbortSignal.timeout(3_000), 3_000)
				.catch(() => undefined);
	};
	signal.addEventListener("abort", stop, { once: true });
	try {
		const effective = record(await client.request("config/read", { cwd: client.cwd, includeLayers: false }, signal));
		const names = Object.keys(record(record(effective.config).mcp_servers ?? {}));
		const start = record(
			await client.request(
				"thread/start",
				{
					ephemeral: true,
					cwd: client.cwd,
					model: "gpt-6-luna",
					approvalPolicy: "never",
					sandbox: "read-only",
					baseInstructions: "",
					developerInstructions:
						"Only perform native hosted web search and return a concise sourced result. Do not run commands, use MCP, delegate work, access local files, or modify anything.",
					config: searchConfig(names),
					environments: [],
					dynamicTools: [],
				},
				signal,
			),
		);
		const id = record(start.thread).id;
		if (typeof id !== "string" || typeof start.model !== "string")
			throw new Error("Search thread/start omitted id/model");
		thread = id;
		if ((await client.statuses(thread, signal)).some((server) => Object.keys(record(server.tools)).length))
			throw new Error("Search thread still exposes MCP tools");
		const early: Array<{ method: string; params: RecordValue }> = [];
		const items = new Map<string, RecordValue>();
		let complete: (value: RecordValue) => void = () => {};
		let fail: (error: Error) => void = () => {};
		const finished = new Promise<RecordValue>((resolve, reject) => {
			complete = resolve;
			fail = reject;
		});
		// The collector may fail while turn/start is pending; attach a handler immediately.
		void finished.catch(() => {});
		const collect = (method: string, params: RecordValue) => {
			if (method === "connection/error") {
				fail(new Error(String(params.message)));
				return;
			}
			if (params.threadId !== thread) return;
			if (!turn) {
				early.push({ method, params });
				return;
			}
			if (
				params.turnId !== turn &&
				!(method === "error" && params.turnId == null) &&
				!(method === "turn/completed" && record(params.turn).id === turn)
			)
				return;
			if (method === "item/completed") {
				const item = record(params.item);
				items.set(String(item.id), item);
				if (!["userMessage", "agentMessage", "webSearch", "reasoning"].includes(String(item.type))) {
					stop();
					fail(new Error(`Hosted search unexpected item ${String(item.type)}`));
				}
			} else if (method === "turn/completed") complete(record(params.turn));
			else if (method === "error" && params.willRetry !== true)
				fail(new Error(`Hosted search failed: ${String(record(params.error).message)}`));
		};
		release = client.onNotification(collect);
		const abort = () => fail(signal.reason ?? new Error("Hosted search aborted"));
		signal.addEventListener("abort", abort, { once: true });
		try {
			const response = record(
				await client.request(
					"turn/start",
					{ threadId: thread, effort: "low", input: [{ type: "text", text: query }] },
					signal,
				),
			);
			const started = record(response.turn);
			if (typeof started.id !== "string") throw new Error("Search turn/start omitted id");
			turn = started.id;
			for (const event of early) collect(event.method, event.params);
			if (["completed", "failed", "interrupted"].includes(String(started.status))) complete(started);
			if (signal.aborted) abort();
			const done = await finished;
			for (const entry of Array.isArray(done.items) ? done.items : []) {
				const item = record(entry);
				items.set(String(item.id), item);
			}
			return searchResult(start.model, thread, turn, done.status, [...items.values()]);
		} finally {
			signal.removeEventListener("abort", abort);
		}
	} finally {
		signal.removeEventListener("abort", stop);
		release();
		await interrupt;
		if (thread) await client.request("thread/unsubscribe", { threadId: thread }, AbortSignal.timeout(3_000), 3_000);
	}
}
