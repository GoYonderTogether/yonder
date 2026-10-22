import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type Capability,
	definePlugin,
	type ExecutionOwner,
	type PluginAPI,
	type ToolContext,
	type ToolResult,
	type TSchema,
	type YEvent,
} from "@yonder/sdk";
import { ClipError, config, fail, grantFor, sameOwner } from "./config.js";
import { consume, pasteFile, utf8 } from "./consumers.js";
import { allowedPath, Store, safeRead } from "./store.js";

const string = { type: "string", minLength: 1, maxLength: 4096 };
const obj = (properties: object, required: string[] = Object.keys(properties)): TSchema =>
	({ type: "object", properties, required, additionalProperties: false }) as TSchema;
const integer = { type: "integer", minimum: 0 };
const source = {
	oneOf: [
		obj({ kind: { const: "message" }, eventId: string }),
		obj({ kind: { const: "file" }, path: string, start: integer, end: integer }, ["kind", "path"]),
		obj({ kind: { const: "tool" }, transcriptId: { type: "integer", minimum: 1 } }),
	],
};
const target = {
	oneOf: [
		obj({ kind: { const: "file" }, path: string }),
		obj({ kind: { const: "consumer" }, id: string }),
		obj({ kind: { const: "message" }, target: string }),
		obj({ kind: { const: "vault" } }),
	],
};
const ttl = { type: "integer", minimum: 1, maximum: 86400 };
const reply = (data: unknown): ToolResult => ({ text: JSON.stringify(data) });
const owner = (ctx: ExecutionOwner): ExecutionOwner => ({
	agent: ctx.agent,
	profile: ctx.profile,
	session: ctx.session,
});
const safeCode = (error: unknown) => (error instanceof ClipError ? error.message : "clipboard_operation_failed");
export default definePlugin({
	setup(api: PluginAPI) {
		const options = config(api.config),
			store = new Store(api.paths.data, options);
		async function audit(ctx: ExecutionOwner, operation: string, phase: string, extra: object = {}) {
			await api.events.emit({ type: "clipboard.audit", data: { ...owner(ctx), operation, phase, ...extra } });
		}
		async function importAudit() {
			let files: string[];
			try {
				files = await readdir(join(store.data, "audit"));
			} catch (e) {
				if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
				throw e;
			}
			for (const file of files) {
				if (!/^[0-9a-f-]{36}\.json$/.test(file)) continue;
				const path = join(store.data, "audit", file);
				const data = JSON.parse((await safeRead(path, 16384)).toString());
				await api.events.emit({ type: "clipboard.audit", data });
				await rm(path);
			}
		}
		const add = (
			name: string,
			description: string,
			parameters: TSchema,
			capabilities: Capability[],
			run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>,
		) => {
			api.tools.register({
				name: `clipboard_${name}`,
				description,
				parameters,
				capabilities,
				async execute(input, ctx) {
					try {
						grantFor(options, ctx);
						if (ctx.env.id !== "node:local") fail("local_environment_required");
						ctx.signal.throwIfAborted();
						await audit(ctx, name, "intent");
						await importAudit();
						const result = await run(input as Record<string, unknown>, ctx);
						await audit(
							ctx,
							name,
							"completed",
							result && typeof result === "object"
								? Object.fromEntries([
										...Object.entries(result).filter(
											([key, value]) =>
												["ok", "status", "exitCode", "byteLength", "written"].includes(key) &&
												(typeof value === "boolean" || typeof value === "number"),
										),
										...("id" in result ? [["handle", String(result.id)]] : []),
									])
								: {},
						);
						return reply(result);
					} catch (error) {
						const code = safeCode(error);
						try {
							await audit(ctx, name, "failed", { code });
						} catch {
							return { text: "clipboard_audit_unavailable", isError: true };
						}
						return { text: code, isError: true };
					}
				},
			});
		};
		add(
			"copy",
			"Copy exact source bytes into an opaque clipboard handle, without transcribing content. Use an inbound event id from this conversation, an absolute granted file path (optional byte range), or a tool-result transcript id from this session. Results contain metadata only. Only file sources may be sealed; message/tool content is already visible history.",
			obj({ from: source, class: { enum: ["open", "sealed"] }, ttlSeconds: ttl }, ["from"]),
			["read", "write"],
			async (args, ctx) => {
				const from = args.from as {
					kind: string;
					eventId?: string;
					path?: string;
					start?: number;
					end?: number;
					transcriptId?: number;
				};
				const kind = args.class === "sealed" ? "sealed" : "open",
					g = grantFor(options, ctx);
				if (kind === "sealed" && (!g.sealed || from.kind !== "file")) fail("sealed_source_not_granted");
				let bytes: Buffer, ref: string;
				if (from.kind === "file") {
					const path = await allowedPath(from.path!, g.readRoots);
					bytes = await safeRead(path, options.maxBytes, from.start, from.end);
					ref = path;
				} else if (from.kind === "message") {
					const conv = ctx.event?.conv;
					if (!conv) return fail("source_conversation_required");
					let event: YEvent | undefined, after: string | undefined;
					do {
						const page = await api.events.query({ type: "message.in", conv, limit: 100, ...(after ? { after } : {}) });
						event = page.events.find((e) => e.id === from.eventId);
						after = page.next;
						if (event) break;
						ctx.signal.throwIfAborted();
					} while (after);
					if (
						event?.type !== "message.in" ||
						event.conv !== conv ||
						typeof (event.data as { text?: unknown }).text !== "string"
					)
						return fail("message_not_in_conversation");
					bytes = Buffer.from((event.data as { text: string }).text);
					ref = event.id;
				} else if (from.kind === "tool") {
					const entries = await api.sessions.transcript(ctx.session, { from: from.transcriptId!, limit: 1 });
					const entry = entries.find((e) => e.id === from.transcriptId);
					if (!entry || !["pi.tool-result"].includes(entry.kind)) return fail("tool_result_not_found");
					bytes = Buffer.from(entry.text);
					ref = String(entry.id);
				} else return fail("invalid_source");
				try {
					return await store.save(
						bytes,
						kind,
						owner(ctx),
						{ type: from.kind, ref },
						ctx.signal,
						args.ttlSeconds as number | undefined,
					);
				} finally {
					bytes.fill(0);
				}
			},
		);
		add(
			"paste",
			"Paste a handle from clipboard_copy/list/capture to a create-only granted file, configured consumer id, allowed message target (open UTF-8 only), or vault (new sealed handle). No plaintext, arbitrary commands or URLs. A consumer failure may have external effects: inspect before retrying. Sealed file output trusts the destination; exec is not a sandbox.",
			obj({ handle: string, to: target }),
			["read", "write"],
			async (args, ctx) => {
				const clip = await store.get(String(args.handle), ctx),
					g = grantFor(options, ctx),
					to = args.to as { kind: string; path?: string; id?: string; target?: string };
				if (clip.class === "sealed" && !g.sealed) fail("sealed_not_granted");
				await audit(ctx, "paste", "destination", { handle: clip.id, destination: to.kind });
				if (to.kind === "message" && (clip.class === "sealed" || !g.messageTargets.includes(to.target!)))
					fail("message_not_granted");
				if (to.kind === "consumer" && (!g.destinations.includes(to.id!) || !options.consumers[to.id!]))
					fail("consumer_not_granted");
				if (
					to.kind === "consumer" &&
					!ctx.capabilities.includes(options.consumers[to.id!]?.kind === "child" ? "exec" : "network")
				)
					fail("consumer_capability_required");
				const path = to.kind === "file" ? await allowedPath(to.path!, g.writeRoots, true) : undefined;
				return store.consume(clip, ctx.signal, async (bytes) => {
					if (path) return pasteFile(path, bytes, ctx.signal);
					if (to.kind === "vault") {
						if (!g.sealed) return fail("sealed_not_granted");
						if (clip.class === "sealed") return clip;
						return store.save(bytes, "sealed", owner(ctx), { type: "clip", ref: clip.id }, ctx.signal);
					}
					if (to.kind === "consumer") return consume(options.consumers[to.id!]!, bytes, ctx.signal);
					if (to.kind === "message") {
						const delivery = await api.messages.send({ to: to.target!, text: utf8(bytes), signal: ctx.signal }, ctx);
						return {
							ok: delivery.ok,
							...(delivery.id ? { id: delivery.id } : {}),
							...(delivery.uncertain ? { uncertain: true } : {}),
						};
					}
					return fail("invalid_destination");
				});
			},
		);
		add(
			"list",
			"List unexpired clipboard metadata for this session/agent/profile. Open and sealed contents are never returned. Handles do not grant access across sessions.",
			obj({}),
			["read"],
			async (_args, ctx) =>
				(await store.all()).filter((c) => sameOwner(c, ctx) && Date.parse(c.expiresAt) > Date.now()),
		);
		add(
			"drop",
			"Delete this session's handle and its Keychain item, including expired handles. Audit history and any files already pasted remain. Shared open blobs are retained for explicit offline cleanup.",
			obj({ handle: string }),
			["write"],
			async (args, ctx) => {
				const clip = await store.get(String(args.handle), ctx, true);
				if (clip.class === "sealed" && !grantFor(options, ctx).sealed) fail("sealed_not_granted");
				await store.drop(clip, ctx.signal);
				return { dropped: clip.id };
			},
		);
		add(
			"capture",
			"Create a one-use sealed capture ticket for this session. Ask the owner to run the returned local hidden-TTY commands; never ask them to send the secret in chat. Use clipboard_list afterwards to find the captured handle. No browser or Feishu private capture adapter is available.",
			obj({ ttlSeconds: ttl }, []),
			["write"],
			async (args, ctx) => {
				if (!grantFor(options, ctx).sealed) fail("sealed_not_granted");
				const ticket = await store.ticket(owner(ctx), args.ttlSeconds as number | undefined);
				const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`,
					cli = fileURLToPath(new URL("./capture.js", import.meta.url));
				return {
					handle: ticket.id,
					expiresAt: ticket.expiresAt,
					ownerSteps: [
						`${quote(process.execPath)} ${quote(cli)} prepare --data ${quote(store.data)}`,
						`${quote(process.execPath)} ${quote(cli)} capture --data ${quote(store.data)} --ticket ${quote(ticket.id)}`,
					],
				};
			},
		);
		api.hooks.register({
			id: "clipboard-redact",
			async afterTool(_call, result, ctx) {
				try {
					const redacted = await store.redact(result.text, ctx.signal);
					return {
						result: { ...result, text: redacted.text, ...(redacted.active ? { images: [], attachments: [] } : {}) },
					};
				} catch {
					return { result: { text: "clipboard_redaction_unavailable", isError: true } };
				}
			},
			async beforeSend(message, scope) {
				if (!scope) return;
				try {
					const redacted = await store.redact(message.text, AbortSignal.timeout(60000));
					return { message: { ...message, text: redacted.text, ...(redacted.active ? { attachments: [] } : {}) } };
				} catch {
					return { message: { text: "clipboard_redaction_unavailable" } };
				}
			},
		});
	},
});
