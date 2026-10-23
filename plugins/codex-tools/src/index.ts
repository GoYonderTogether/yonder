import { definePlugin, defineTool, type ToolContext, type ToolResult } from "@yonder/sdk";
import { Type } from "typebox";
import { AppServer } from "./app-server.js";
import { computerCall, computerStatus, desktopThread } from "./computer-use.js";
import { hostedSearch } from "./search.js";

function failureState(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	if (/Program missing|ENOENT/i.test(message)) return "program-missing";
	if (/Accessibility|Screen Recording|permission denied|not authorized/i.test(message))
		return "permission-not-authorized";
	if (/login|unauthorized|authentication|401/i.test(message)) return "login-required";
	if (/MCP unavailable|installation\/service|app-server exited|stdout closed/i.test(message))
		return "service-unavailable";
	return "call-failed";
}
const empty = Type.Object({}, { additionalProperties: false });
const js = Type.Object(
	{
		code: Type.String({ minLength: 1 }),
		title: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
		timeout_ms: Type.Optional(Type.Integer({ minimum: 1, maximum: 2_147_478_647 })),
	},
	{ additionalProperties: false },
);
interface Resource {
	client: AppServer;
	desktop?: string;
}

export default definePlugin({
	setup(api) {
		const resources = new Map<string, Promise<Resource>>();
		let stopped = false;
		let lifecycle = new AbortController();
		const busy = new Set<string>();
		function desktop(resource: Resource): string {
			if (!resource.desktop) throw new Error("Desktop thread not initialized");
			return resource.desktop;
		}
		async function dispose(session: string): Promise<void> {
			const resource = resources.get(session);
			resources.delete(session);
			if (!resource) return;
			let value: Resource;
			try {
				value = await resource;
			} catch {
				return;
			}
			try {
				if (value.desktop)
					await value.client.request(
						"thread/unsubscribe",
						{ threadId: value.desktop },
						AbortSignal.timeout(3_000),
						3_000,
					);
			} finally {
				await value.client.close();
			}
		}
		async function execute(
			ctx: ToolContext,
			search: boolean,
			operation: (resource: Resource, signal: AbortSignal) => Promise<ToolResult>,
		): Promise<ToolResult> {
			if (stopped) return { isError: true, text: "codex-tools lifecycle stopped" };
			if (busy.has(ctx.session))
				return {
					isError: true,
					text: "A codex-tools call is already running in this session; wait for its result before the next observation/action.",
				};
			busy.add(ctx.session);
			const deadline = new AbortController();
			const timer = search
				? setTimeout(() => deadline.abort(new Error("Hosted search timed out after 90000ms")), 90_000)
				: undefined;
			const signal = AbortSignal.any([ctx.signal, lifecycle.signal, deadline.signal]);
			try {
				signal.throwIfAborted();
				let pending = resources.get(ctx.session);
				if (!pending) {
					pending = AppServer.open(signal).then((client) => ({ client }));
					resources.set(ctx.session, pending);
				}
				const resource = await pending;
				signal.throwIfAborted();
				if (!search && !resource.desktop) resource.desktop = await desktopThread(resource.client, signal);
				return await operation(resource, signal);
			} catch (error) {
				let cleanup = "";
				try {
					await dispose(ctx.session);
				} catch (failure) {
					cleanup = ` Cleanup failed: ${String(failure)}`;
				}
				return {
					isError: true,
					text: `Codex app-server [${signal.aborted ? "cancelled" : failureState(error)}]: ${error instanceof Error ? error.message : String(error)}. Connection released; CUA actions may already have taken effect. Do not replay: read fresh state before acting. If the native error reports Accessibility/Screen Recording denial, grant the requested permission in macOS System Settings and read state again; no alternate driver is used.${cleanup}`,
				};
			} finally {
				clearTimeout(timer);
				busy.delete(ctx.session);
			}
		}
		api.tools.register(
			defineTool({
				name: "codex-tools_status",
				parameters: empty,
				capabilities: ["exec"],
				description:
					"Discover official local Codex Computer Use and return its real tool instructions/schemas. Discovery is not a permission check. Call this before JS. JS bindings persist only within the current Yonder run; run.end releases them. Each new run must initialize with exactly one documented entry. Browsers default to BrowserSkill. This bridge exposes local computer use and hosted search, not a cloud coding Agent. If discovery fails, inspect the returned native app-server error and installed CLI/login state; never borrow OAuth files or reinstall the whole assistant as a first step. Use js_reset for lost JS bindings, then initialize again; it does not reset the user applications.",
				execute: (_args, ctx) =>
					execute(ctx, false, (resource, signal) => computerStatus(resource.client, desktop(resource), signal)),
			}),
		);
		api.tools.register(
			defineTool({
				name: "codex-tools_js",
				parameters: js,
				capabilities: ["exec"],
				description:
					"Run official cua_repl JavaScript, persistent only within this Yonder run. run.end releases all bindings; each new run starts with exactly one documented entry. Requires host exec, not a read-only sandbox. First call or after reset: exactly one documented entry such as await cua.getState(); read its documentation before continuing. Native app AX/screenshot/click/typeText/pressKey/scroll use the real cua API. Keep focus unless explicitly authorized; after actions observe fresh AX state. Do not blindly replay actions after error. Prefer BrowserSkill for browsers.",
				execute: (args, ctx) =>
					execute(ctx, false, (resource, signal) =>
						computerCall(resource.client, desktop(resource), "js", args, signal),
					),
			}),
		);
		api.tools.register(
			defineTool({
				name: "codex-tools_js_reset",
				parameters: empty,
				capabilities: ["exec"],
				description:
					"Explicitly reset CUA JavaScript bindings. Does not close or undo changes to user apps. Next JS call must use exactly one documented entry.",
				execute: (args, ctx) =>
					execute(ctx, false, (resource, signal) =>
						computerCall(resource.client, desktop(resource), "js_reset", args, signal),
					),
			}),
		);
		api.tools.register(
			defineTool({
				name: "codex-tools_search",
				parameters: Type.Object({ query: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
				capabilities: ["exec", "network"],
				description:
					"Bounded native hosted web search using the existing Codex login and gpt-6-luna. Returns actual model, native webSearch evidence and untrusted source URLs; fails without native search evidence. No OAuth export or provider fallback.",
				execute: (args, ctx) =>
					execute(ctx, true, (resource, signal) =>
						hostedSearch(resource.client, (args as { query: string }).query, signal),
					),
			}),
		);
		api.events.on("run.end", async (event) => {
			const session = (event.data as { session?: unknown }).session;
			if (typeof session === "string") await dispose(session);
		});
		api.triggers.register({
			id: "codex-tools-lifecycle",
			async start() {
				stopped = false;
				lifecycle = new AbortController();
			},
			async stop() {
				stopped = true;
				lifecycle.abort(new Error("codex-tools lifecycle stopped"));
				const settled = await Promise.allSettled([...resources.keys()].map(dispose));
				const failed = settled.find((result) => result.status === "rejected");
				if (failed?.status === "rejected") throw failed.reason;
			},
		});
	},
});
