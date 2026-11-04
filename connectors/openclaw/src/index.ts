/**
 * OpenClaw feature plugin entry: registers the Yonder connector.
 *
 * The connector is an outbound-only device client (spec 23): it opens one
 * `/ws/device` connection to the Yonder account, registers this gateway's
 * agents as Bots, and answers the five session work methods over the cloud's
 * existing work bridge. Session driving goes through the local Gateway
 * WebSocket (the same protocol the CLI and Control UI speak), isolated in
 * `gateway.ts` — the one file allowed to know the local RPC shapes.
 *
 * Degradation (spec 23 §4): an unresolvable Gateway connection or a missing
 * pairing keeps OpenClaw healthy and reports honestly via the yonder_status
 * tool; nothing here may fail the gateway startup.
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "typebox";
import { connectYonder, disconnectYonder, statusText, type ConnectorRuntime } from "./connector.js";
import { stateDir as defaultStateDir } from "./frames.js";

/** Resolve the local Gateway connection facts from the OpenClaw runtime. */
function resolveRuntime(api: unknown): ConnectorRuntime {
	type Api = {
		config?: {
			gateway?: { port?: unknown };
		};
		runtime?: {
			config?: { current?: () => Record<string, unknown> };
		};
	};
	const source = api as Api;
	let cfg: Record<string, unknown> = {};
	try {
		cfg = source.runtime?.config?.current?.() ?? source.config ?? {};
	} catch {
		cfg = source.config ?? {};
	}
	const gateway = (cfg.gateway ?? {}) as { port?: unknown; auth?: { token?: unknown } };
	const port = typeof gateway.port === "number" && gateway.port > 0 ? gateway.port : 18789;
	const token = typeof gateway.auth?.token === "string" ? gateway.auth.token : undefined;
	// OpenClaw's own agents: the default install runs one agent (`main`). A
	// configured `agents.list` adds more; the connector registers all of them.
	const agentsList = (cfg.agents as { list?: Array<{ id?: unknown; name?: unknown }> } | undefined)?.list;
	const agents = (agentsList ?? []).flatMap((row) => {
		if (typeof row.id !== "string" || !row.id) return [];
		const name = typeof row.name === "string" && row.name ? row.name : row.id;
		return [{ key: row.id, name }];
	});
	if (!agents.some((row) => row.key === "main")) agents.unshift({ key: "main", name: "OpenClaw" });
	return {
		agents,
		gatewayUrl: `ws://127.0.0.1:${port}`,
		gatewayToken: token,
		defaultAgentId: "main",
	};
}

export default definePluginEntry({
	id: "yonder-connector",
	name: "Yonder Connector",
	description:
		"Registers this OpenClaw gateway with a Yonder account (Bots + remote session driving, spec 23).",
	register(api) {
		const config = (api.pluginConfig ?? {}) as {
			endpoint?: unknown;
			stateDir?: unknown;
			toolsOnly?: unknown;
		};
		const endpoint = typeof config.endpoint === "string" && config.endpoint.trim() ? config.endpoint.trim() : undefined;
		const stateDir = typeof config.stateDir === "string" && config.stateDir.trim() ? config.stateDir.trim() : undefined;
		const toolsOnly = config.toolsOnly === true;
		const logger = api.logger;

		api.registerTool({
			name: "yonder_status",
			label: "Yonder status",
			description: "Report whether this OpenClaw gateway is connected to a Yonder account and how many Bots it registered.",
			parameters: Type.Object({}),
			async execute() {
				const status = statusText();
				return {
					content: [{ type: "text", text: status }],
					details: { status },
				};
			},
		});

		if (toolsOnly) {
			logger.info("[yonder] toolsOnly=true; 后台连接未启动。");
			return;
		}

		// Services own the lifecycle: start after gateway startup, stop at shutdown.
		api.registerService({
			id: "yonder-connector",
			start: () => {
				try {
					connectYonder({
						endpoint,
						stateDir: stateDir ?? defaultStateDir(),
						log: (message) => logger.info(`[yonder] ${message}`),
						runtime: resolveRuntime(api),
					});
				} catch (error) {
					logger.warn(`[yonder] 连接未启动：${error instanceof Error ? error.message : String(error)}`);
				}
			},
			stop: () => {
				disconnectYonder();
			},
		});
	},
});
