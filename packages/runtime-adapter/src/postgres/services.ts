import { randomUUID } from "node:crypto";
import type { CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import type { ToolExecutionApi, ToolExecutionResult, ToolRegistration } from "@earendil-works/pi-durable";
import { getOrThrow } from "@earendil-works/pi-durable/env";
import { createNodePhotonImages } from "@earendil-works/pi-durable/images/node";
import type { Pool } from "pg";
import { Type } from "typebox";
import type { RuntimeServices } from "../contracts.js";
import { createBackground } from "../runtime/background.js";
import type { RuntimeInternals } from "../runtime/instance.js";
import { ModelGate } from "../runtime/model-gate.js";
import { ModelHealth, type ModelHealthRecord } from "../runtime/model-health.js";
import { ModelQuota, type QuotaWindow } from "../runtime/model-quota.js";
import { ModelWatch } from "../runtime/model-watch.js";
import { buildModels, type ModelsJsonModel } from "../runtime/models.js";
import { noEnvironment } from "../runtime/no-environment.js";
import { modelTimeouts } from "../runtime/recovery.js";
import { fromResult, toResult } from "../runtime/results.js";
import type { RuntimeBackgroundOptions, RuntimeToolHost } from "../runtime/tool-activation.js";

function glmModelDefinition(): ModelsJsonModel {
	const zai = builtinProviders().find((provider) => provider.id === "zai");
	const model = zai?.getModels().find((candidate) => candidate.id === "glm-5.3-flash");
	if (!model) throw new Error("The installed Z.AI model catalog does not contain glm-5.3-flash");
	return {
		id: "glm-5.3-flash",
		name: model.name,
		api: model.api,
		input: model.input,
		reasoning: model.reasoning,
		cost: model.cost,
		contextWindow: model.contextWindow,
		maxTokens: model.maxTokens,
		...(model.thinkingLevelMap !== undefined ? { thinkingLevelMap: model.thinkingLevelMap } : {}),
		...(model.inputLimits !== undefined ? { inputLimits: model.inputLimits } : {}),
		...(model.promptCache !== undefined ? { promptCache: model.promptCache } : {}),
		...(model.samplingParams !== undefined ? { samplingParams: model.samplingParams } : {}),
		...(model.samplingParamsByThinkingLevel !== undefined
			? { samplingParamsByThinkingLevel: model.samplingParamsByThinkingLevel }
			: {}),
		...(model.compat !== undefined ? { compat: model.compat } : {}),
	};
}

const providerConfig = (baseUrl: string, model: ModelsJsonModel) => ({
	"rightapi-glm": {
		baseUrl,
		api: "openai-completions",
		authHeader: true,
		compat: { systemAsUser: true, supportsStore: false, supportsDeveloperRole: false },
		models: [model],
	},
});

const serviceSchema = `CREATE TABLE IF NOT EXISTS bot_runtime_service_state (
	service TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS bot_runtime_tool_output (
	tenant_id TEXT NOT NULL, bot_id TEXT NOT NULL, output_id TEXT NOT NULL, content TEXT NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,bot_id,output_id)
)`;

function keyStore(key: string): CredentialStore {
	return {
		async read(name) {
			return name === "rightapi-glm" ? { type: "api_key", key } : undefined;
		},
		async list(): Promise<readonly CredentialInfo[]> {
			return [{ providerId: "rightapi-glm", type: "api_key" }];
		},
		async modify() {
			throw new Error("Cloud model credentials are platform-managed");
		},
		async delete() {
			throw new Error("Cloud model credentials are platform-managed");
		},
	};
}

function createPostgresToolHost(pool: Pool, tenant: string, bot: string, outputPrefix: string): RuntimeToolHost {
	const save = async (content: string) => {
		const id = randomUUID();
		await pool.query("INSERT INTO bot_runtime_tool_output(tenant_id,bot_id,output_id,content) VALUES($1,$2,$3,$4)", [
			tenant,
			bot,
			id,
			content,
		]);
		await pool.query(
			"DELETE FROM bot_runtime_tool_output WHERE tenant_id=$1 AND bot_id=$2 AND created_at < now() - interval '7 days'",
			[tenant, bot],
		);
		return `${outputPrefix}${id}`;
	};
	const logs = {
		joinPath: (...parts: string[]) => parts.join("/"),
		async exists(path: string) {
			const id = path.startsWith(outputPrefix) ? path.slice(outputPrefix.length) : "";
			if (!id) return false;
			const result = await pool.query(
				"SELECT 1 FROM bot_runtime_tool_output WHERE tenant_id=$1 AND bot_id=$2 AND output_id=$3",
				[tenant, bot, id],
			);
			return Boolean(result.rowCount && result.rowCount > 0);
		},
		async read(path: string, maxBytes: number, tail: boolean) {
			const id = path.startsWith(outputPrefix) ? path.slice(outputPrefix.length) : "";
			const result = await pool.query<{ content: string }>(
				"SELECT content FROM bot_runtime_tool_output WHERE tenant_id=$1 AND bot_id=$2 AND output_id=$3",
				[tenant, bot, id],
			);
			if (!result.rows[0]) throw new Error("Background output was not found");
			const bytes = new TextEncoder().encode(result.rows[0].content);
			const slice = tail ? bytes.subarray(Math.max(0, bytes.length - maxBytes)) : bytes.subarray(0, maxBytes);
			return {
				content: new TextDecoder().decode(slice),
				truncated: bytes.length > slice.length,
				bytesRead: slice.length,
				totalBytes: bytes.length,
			};
		},
	};
	return {
		cacheTools: true,
		cacheOutput: () => true,
		async readCachedOutput(path, offset = 1, limit = 200) {
			if (!path.startsWith(outputPrefix)) return undefined;
			const id = path.slice(outputPrefix.length);
			const start = typeof offset === "number" ? offset : /^\d+$/.test(offset) ? Number(offset) : NaN;
			if (!Number.isSafeInteger(start) || start < 1) throw new Error("Cached output offset must be a line number");
			const count = Math.max(1, Math.min(2000, limit ?? 200));
			const result = await pool.query<{ total: number; content: string | null }>(
				`SELECT cardinality(lines)::int AS total,
					array_to_string(lines[$4:$5], E'\\n') AS content
				 FROM (SELECT regexp_split_to_array(content, E'\\n') AS lines
					 FROM bot_runtime_tool_output WHERE tenant_id=$1 AND bot_id=$2 AND output_id=$3) cached`,
				[tenant, bot, id, start, start + count - 1],
			);
			const page = result.rows[0];
			if (!page) throw new Error("Cached output was not found in this bot");
			if (start > page.total) throw new Error(`Offset ${start} is beyond end of cached output (${page.total} lines)`);
			const end = Math.min(page.total, start + count - 1);
			return {
				output: [
					{
						type: "text" as const,
						text: `${start}-${end} of ${page.total} lines in cached output\n${page.content ?? ""}`,
					},
				],
			};
		},
		async grepCachedOutput(input) {
			const path = input.path;
			if (!path?.startsWith(outputPrefix)) return undefined;
			const id = path.slice(outputPrefix.length);
			const result = await pool.query<{ content: string }>(
				"SELECT content FROM bot_runtime_tool_output WHERE tenant_id=$1 AND bot_id=$2 AND output_id=$3",
				[tenant, bot, id],
			);
			const content = result.rows[0]?.content;
			if (content === undefined) throw new Error("Cached output was not found in this bot");
			const pattern = input.literal ? input.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : input.pattern;
			const expression = new RegExp(pattern, input.ignoreCase ? "i" : "");
			const lines = content.split("\n");
			const limit = Math.max(1, Math.min(1000, input.limit ?? 100));
			const contextLines = Math.max(0, Math.min(20, input.context ?? 0));
			const indexes = new Set<number>();
			const matched = new Set<number>();
			for (let index = 0; index < lines.length; index++) {
				const line = lines[index];
				if (line === undefined || !expression.test(line)) continue;
				matched.add(index);
				for (
					let row = Math.max(0, index - contextLines);
					row <= Math.min(lines.length - 1, index + contextLines);
					row++
				)
					indexes.add(row);
				if (matched.size >= limit) break;
			}
			return {
				text:
					[...indexes]
						.sort((left, right) => left - right)
						.map((index) => `${index + 1}${matched.has(index) ? ":" : "-"} ${lines[index]}`)
						.join("\n") || "No matches found",
			};
		},
		createBackground(options: RuntimeBackgroundOptions) {
			return createBackground({
				...options,
				logs,
				outputCapture: () => {
					const chunks: string[] = [];
					return {
						write: (text) => chunks.push(text),
						finish: () => save(chunks.join("")),
						async cleanup() {
							chunks.length = 0;
						},
					};
				},
			});
		},
		processTool(_home, _running, _resolveSession): ToolRegistration {
			return {
				name: "bash",
				deferred: true,
				description: "Run a command in this environment. Command execution is unavailable.",
				parameters: Type.Object({
					command: Type.String(),
					cwd: Type.Optional(Type.String()),
					background: Type.Optional(Type.Boolean()),
					stdin: Type.Optional(Type.Boolean()),
					timeout: Type.Optional(Type.Number()),
				}),
				async execute(value, api: ToolExecutionApi, context) {
					const args = value as { command: string; cwd?: string };
					const environment = api.env;
					if (!environment) throw new Error("Execution environment is unavailable");
					const output: string[] = [];
					const result = getOrThrow(
						await environment.exec(
							args.command,
							{
								...(args.cwd ? { cwd: args.cwd } : {}),
								onOutput: (text) => {
									output.push(text);
									api.output(text);
								},
							},
							context,
						),
					);
					const response: ToolExecutionResult = {
						output: [{ type: "text", text: JSON.stringify({ output: output.join(""), exitCode: result.exitCode }) }],
						isError: result.exitCode !== 0,
					};
					return response;
				},
			};
		},
		async cacheSdkResult(result, _context, _input, _options) {
			const value = fromResult(result);
			const bytes = new TextEncoder().encode(value.text);
			if (bytes.byteLength > 50 * 1024 || value.text.split("\n").length > 2000) {
				const path = await save(value.text);
				value.text = `Full output: ${path}. Use read to paginate or grep to search.\n${new TextDecoder().decode(bytes.subarray(0, 48 * 1024))}`;
			}
			return toResult(value);
		},
		toolOutputWriter(_context, _tool, _args, _home) {
			return async (value) => {
				let content: string;
				if (typeof value === "string") content = value;
				else {
					const chunks: Uint8Array[] = [];
					let length = 0;
					for await (const chunk of value) {
						chunks.push(chunk);
						length += chunk.byteLength;
					}
					const bytes = new Uint8Array(length);
					let offset = 0;
					for (const chunk of chunks) {
						bytes.set(chunk, offset);
						offset += chunk.byteLength;
					}
					content = new TextDecoder().decode(bytes);
				}
				return save(content);
			};
		},
		fileURLToPath(uri) {
			const url = new URL(uri);
			if (url.protocol !== "file:") throw new Error("Expected a file URL");
			return decodeURIComponent(url.pathname);
		},
		remoteFind: async () => {
			throw new Error("Remote workspace search is unavailable");
		},
		remoteGrep: async () => {
			throw new Error("Remote workspace search is unavailable");
		},
	};
}

export async function createPostgresRuntimeServices(options: {
	pool: Pool;
	apiKey: string;
	baseUrl?: string;
	onReport?: (error: unknown) => void;
}): Promise<{ forBot(tenant: string, bot: string): RuntimeServices; close(): Promise<void> }> {
	if (!options.apiKey || /[\r\n\0]/.test(options.apiKey)) throw new Error("Invalid platform model credential");
	const pool = options.pool;
	await pool.query(serviceSchema);
	const credential = keyStore(options.apiKey);
	const health = new ModelHealth({
		async load() {
			const result = await pool.query<{ value: unknown }>(
				"SELECT value FROM bot_runtime_service_state WHERE service='health'",
			);
			return result.rows[0]?.value;
		},
		async save(value: { version: 1; models: Record<string, ModelHealthRecord> }) {
			await pool.query(
				"INSERT INTO bot_runtime_service_state(service,value) VALUES('health',$1) ON CONFLICT(service) DO UPDATE SET value=EXCLUDED.value,updated_at=now()",
				[JSON.stringify(value)],
			);
		},
	});
	const quota = new ModelQuota(
		{
			async load() {
				const result = await pool.query<{ value: unknown }>(
					"SELECT value FROM bot_runtime_service_state WHERE service='quota'",
				);
				return result.rows[0]?.value;
			},
			async save(value: { version: 1; accounts: Record<string, QuotaWindow> }) {
				await pool.query(
					"INSERT INTO bot_runtime_service_state(service,value) VALUES('quota',$1) ON CONFLICT(service) DO UPDATE SET value=EXCLUDED.value,updated_at=now()",
					[JSON.stringify(value)],
				);
			},
		},
		Date.now,
		options.onReport,
	);
	await Promise.all([health.load(), quota.load()]);
	const gate = new ModelGate(health, quota);
	const providers = providerConfig(options.baseUrl ?? "https://api.site/v1", glmModelDefinition());
	let runtime: RuntimeInternals | undefined;
	const modelsForSelection = (
		selection: Readonly<Record<string, string>> = {},
		telemetry?: import("../runtime/models.js").ModelsTelemetry,
	) =>
		buildModels(credential, providers, selection, {}, telemetry, modelTimeouts(runtime?.options.config.timeouts), {
			providers: [],
		});
	const models = modelsForSelection();
	const watch = new ModelWatch({
		health,
		quota,
		gate,
		models: (selection) => modelsForSelection(selection),
		...(options.onReport ? { onReport: options.onReport } : {}),
	});
	const quotaPoller = { watch() {}, async tick() {}, stop() {} };
	let images: ReturnType<typeof createNodePhotonImages> | undefined;
	let closed = false;
	return {
		forBot(tenant, bot): RuntimeServices {
			if (closed) throw new Error("PostgreSQL runtime services are closed");
			const slots: RuntimeServices["credentialSlots"] = {
				defaults: credential,
				async capture(selection) {
					for (const [provider, slot] of Object.entries(selection))
						if (provider !== "rightapi-glm" || slot !== "default")
							throw new Error("Only the platform-managed default RightAPI slot is available");
					return { "rightapi-glm": "platform-managed" };
				},
				bind(selection) {
					for (const [provider, slot] of Object.entries(selection))
						if (provider !== "rightapi-glm" || slot !== "default")
							throw new Error("Only the platform-managed default RightAPI slot is available");
					return credential;
				},
				async beginLogin() {
					throw new Error("Cloud model credentials are platform-managed");
				},
				async commitLogin() {
					throw new Error("Cloud model credentials are platform-managed");
				},
			};
			const services: RuntimeServices = {
				credentials: credential,
				credentialSlots: slots,
				health,
				quota,
				gate,
				watch: {
					order: (...args) => watch.order(...args),
					record: (...args) => watch.record(...args),
					tick: (...args) => watch.tick(...args),
					stop() {},
				},
				quotaPoller: { ...quotaPoller, stop() {} },
				models,
				async modelsFor(config) {
					return modelsForSelection(config.resolved.credentialSlots, {
						onProviderEvent: (_provider, data) => quota.record("rightapi-glm@default", data),
					});
				},
				environment: ({ cwd }) => noEnvironment(cwd),
				async readAttachment() {
					throw new Error("Cloud runtime keeps image attachments as references");
				},
				async imageProcessor() {
					if (!images) images = createNodePhotonImages();
					return images;
				},
				attachmentInput: "reference",
				toolHost: createPostgresToolHost(
					pool,
					tenant,
					bot,
					`pg-output://${encodeURIComponent(tenant)}/${encodeURIComponent(bot)}/`,
				),
				async executeCommand() {
					throw new Error("Command execution is not supported in this runtime host");
				},
				async resolveService() {
					return undefined;
				},
				async login() {
					throw new Error("Cloud model credentials are platform-managed");
				},
				attachRuntime(value) {
					runtime = value;
				},
			};
			return services;
		},
		async close() {
			if (closed) return;
			closed = true;
			watch.stop();
			quotaPoller.stop();
			await quota.flush();
		},
	};
}
