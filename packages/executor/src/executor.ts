import { createHash, createPublicKey, randomUUID } from "node:crypto";
import { createServer, type RequestListener, type Server } from "node:http";
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import { isIP } from "node:net";
import { isAbsolute, relative, sep } from "node:path";
import {
	type CommandReceipt,
	commandDigest,
	commandKey,
	type DeviceSession,
	decodeCommand,
	type ExecutionCapability,
	type Grant,
	OriginSchema,
	type RpcRequest,
	type RpcResponse,
	type SignedEnvelope,
	SignedEnvelopeSchema,
	signMessage,
	verifyMessage,
} from "@yonder/execution-protocol";
import { Check } from "typebox/value";
import type { BackendProvider } from "./backend-provider.js";
import { type CommandRecord, ExecutorStore } from "./store.js";

const errorCodes = new Set([
	"INVALID_REQUEST",
	"UNSUPPORTED_VERSION",
	"UNPAIRED",
	"UNAUTHORIZED",
	"WRONG_TARGET",
	"GRANT_EXPIRED",
	"GRANT_REVOKED",
	"LEASE_EXPIRED",
	"LEASE_STALE",
	"COMMAND_CONFLICT",
	"COMMAND_NOT_FOUND",
	"BUSY",
	"UNSUPPORTED_OPERATION",
	"OUTCOME_UNKNOWN",
	"INTERNAL_ERROR",
]);
const fail = (code: string): never => {
	throw new Error(code);
};
const now = () => new Date().toISOString();
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const has = (grant: Grant, capability: ExecutionCapability) => grant.capabilities.includes(capability);
const covered = (resource: string, roots: string[]) =>
	isAbsolute(resource) &&
	roots.some((root) => {
		if (!isAbsolute(root)) return false;
		const path = relative(root, resource);
		return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
	});

export class DeviceExecutor {
	readonly store: ExecutorStore;
	private readonly requestsInFlight = new Map<string, { digest: string; response: Promise<SignedEnvelope> }>();
	private readonly running = new Map<string, { abort: AbortController; done: Promise<void> }>();
	private writer: string | undefined;
	private server: Server | HttpsServer | undefined;
	private faulted = false;
	constructor(
		home: string,
		readonly backend: BackendProvider,
	) {
		this.store = new ExecutorStore(home);
		queueMicrotask(() => {
			for (const [key, record] of Object.entries(this.store.data.commands))
				if (record.receipt.state === "accepted") this.startDispatch(key);
		});
	}
	get deviceId(): string {
		return this.store.data.deviceId;
	}
	private assertHealthy(): void {
		if (this.faulted) throw new Error("INTERNAL_ERROR");
	}
	private persist(): void {
		this.assertHealthy();
		try {
			this.store.save();
		} catch (error) {
			// The mutable in-memory state may now differ from durable state. Only a new daemon may reload it.
			this.faulted = true;
			throw error;
		}
	}
	private startDispatch(key: string): void {
		if (this.faulted) return;
		void this.dispatch(key).catch(() => {
			this.faulted = true;
		});
	}
	private grant(principalId: string, targetId: string, capability: ExecutionCapability, action?: string): Grant {
		const candidates = Object.values(this.store.data.grants).filter(
			(g) =>
				g.deviceId === this.deviceId &&
				g.principalId === principalId &&
				g.targetIds.includes(targetId) &&
				has(g, capability) &&
				(!action || g.actions.includes(action)),
		);
		const good = candidates.find((g) => !g.revokedAt && Date.parse(g.expiresAt) > Date.now());
		if (good) return good;
		if (candidates.some((g) => g.revokedAt)) fail("GRANT_REVOKED");
		if (candidates.some((g) => Date.parse(g.expiresAt) <= Date.now())) fail("GRANT_EXPIRED");
		return fail("UNAUTHORIZED");
	}
	private session(principalId: string, sessionId: string): DeviceSession {
		const session = this.store.data.sessions[sessionId];
		if (!session || session.principalId !== principalId || session.deviceId !== this.deviceId)
			throw new Error("UNAUTHORIZED");
		if (Date.parse(session.expiresAt) <= Date.now()) fail("LEASE_EXPIRED");
		if (this.store.data.leaseEpochs[session.targetId] !== session.leaseEpoch) fail("LEASE_STALE");
		const grant = this.store.data.grants[session.grantId];
		if (!grant || grant.principalId !== principalId) throw new Error("UNAUTHORIZED");
		if (grant.revokedAt) fail("GRANT_REVOKED");
		if (Date.parse(grant.expiresAt) <= Date.now()) fail("GRANT_EXPIRED");
		if (grant.revision !== session.grantRevision) fail("LEASE_STALE");
		return session;
	}
	private authorizeSession(
		session: DeviceSession,
		capabilities: readonly ExecutionCapability[],
		action?: string,
	): void {
		const grant = this.store.data.grants[session.grantId];
		if (
			!grant ||
			(action && !grant.actions.includes(action)) ||
			capabilities.some((c) => !session.capabilities.includes(c) || !grant.capabilities.includes(c))
		)
			fail("UNAUTHORIZED");
	}
	private authorizeResources(session: DeviceSession, readRoots: string[], writeRoots: string[]): void {
		const grant = this.store.data.grants[session.grantId];
		if (
			!grant ||
			!readRoots.every((root) => covered(root, grant.readRoots)) ||
			!writeRoots.every((root) => covered(root, grant.writeRoots))
		)
			fail("UNAUTHORIZED");
	}
	private record(principalId: string, commandId: string): { key: string; record: CommandRecord } {
		const key = commandKey({ deviceId: this.deviceId, principalId, commandId });
		const record = this.store.data.commands[key];
		if (!record) throw new Error("COMMAND_NOT_FOUND");
		return { key, record };
	}
	private query(principalId: string, commandId: string): CommandReceipt {
		const { record } = this.record(principalId, commandId);
		const grant = this.grant(principalId, record.targetId, "read");
		const receipt = structuredClone(record.receipt);
		if (
			!grant.actions.includes(record.action) ||
			!record.readRoots?.every((root) => covered(root, grant.readRoots)) ||
			!record.writeRoots?.every((root) => covered(root, grant.writeRoots))
		) {
			delete receipt.result;
			delete receipt.error;
		}
		return receipt;
	}
	private async dispatch(key: string): Promise<void> {
		if (this.faulted) return;
		const record = this.store.data.commands[key];
		if (record?.receipt.state !== "accepted") return;
		const command = decodeCommand(record.commandBase64, {
			deviceId: this.deviceId,
			principalId: record.receipt.principalId,
		});
		const action = this.backend.actions[command.action];
		if (!action) {
			record.receipt.state = "failed";
			record.receipt.error = { code: "UNSUPPORTED_OPERATION", message: "UNSUPPORTED_OPERATION" };
			this.persist();
			return;
		}
		let session: DeviceSession;
		try {
			session = this.session(command.principalId, command.deviceSessionId);
			this.authorizeSession(session, action.capabilities, command.action);
			this.authorizeResources(session, record.readRoots, record.writeRoots);
		} catch (error) {
			record.receipt.state = "failed";
			const code = (error as Error).message;
			record.receipt.error = {
				code: (errorCodes.has(code) ? code : "INTERNAL_ERROR") as NonNullable<CommandReceipt["error"]>["code"],
				message: code,
			};
			this.persist();
			return;
		}
		if (action.mutatesDevice && this.writer) return;
		if (action.mutatesDevice) this.writer = key;
		record.receipt.state = "running";
		record.receipt.updatedAt = now();
		this.persist();
		const abort = new AbortController();
		const done = (async () => {
			try {
				const result = await action.execute(command.arguments, { session, signal: abort.signal });
				record.receipt.state = abort.signal.aborted ? "cancelled" : "succeeded";
				if (!abort.signal.aborted) record.receipt.result = result;
			} catch (error) {
				record.receipt.state = abort.signal.aborted ? "cancelled" : "failed";
				if (!abort.signal.aborted) {
					const raw = error instanceof Error ? error.message : "";
					const code = errorCodes.has(raw) ? raw : "INTERNAL_ERROR";
					record.receipt.error = {
						code: code as NonNullable<CommandReceipt["error"]>["code"],
						message: code,
					};
				}
			} finally {
				record.receipt.updatedAt = now();
				try {
					this.persist();
				} finally {
					if (this.writer === key) this.writer = undefined;
					this.running.delete(key);
					if (!this.faulted)
						for (const [waitingKey, waiting] of Object.entries(this.store.data.commands))
							if (waiting.receipt.state === "accepted") queueMicrotask(() => this.startDispatch(waitingKey));
				}
			}
		})();
		this.running.set(key, { abort, done });
		void done.catch(() => {
			this.faulted = true;
		});
	}
	private async operate(request: RpcRequest, commit: (result: unknown) => void): Promise<unknown> {
		const p = request.principalId;
		switch (request.method) {
			case "device.describe": {
				const descriptor = await this.backend.describe();
				if (descriptor.deviceId !== this.deviceId || descriptor.checkpointRestore !== "unsupported")
					fail("INVALID_REQUEST");
				const targets = descriptor.targets.filter((t) => {
					try {
						this.grant(p, t.id, "read");
						return true;
					} catch {
						return false;
					}
				});
				if (!targets.length) fail("UNAUTHORIZED");
				const visible = new Set(targets.map((t) => t.id));
				return { ...descriptor, targets, capabilities: descriptor.capabilities.filter((c) => visible.has(c.scope)) };
			}
			case "device.apps.list": {
				this.grant(p, request.params.targetId, "read");
				const inventory = await this.backend.apps(request.params.targetId);
				if (inventory.deviceId !== this.deviceId || inventory.targetId !== request.params.targetId)
					fail("INVALID_REQUEST");
				return inventory;
			}
			case "device.ui.snapshot": {
				const session = this.session(p, request.params.deviceSessionId);
				this.authorizeSession(session, ["read"]);
				const snapshot = await this.backend.snapshot(session);
				if (
					snapshot.deviceId !== this.deviceId ||
					snapshot.deviceSessionId !== session.deviceSessionId ||
					snapshot.targetId !== session.targetId
				)
					fail("INVALID_REQUEST");
				return snapshot;
			}
			case "device.sessions.open": {
				const { targetId, grantId, capabilities, origin } = request.params;
				if (!Check(OriginSchema, origin) || !capabilities.length || !capabilities.includes("read"))
					fail("INVALID_REQUEST");
				const grant = this.store.data.grants[grantId];
				if (!grant || grant.principalId !== p || !grant.targetIds.includes(targetId)) throw new Error("UNAUTHORIZED");
				this.grant(p, targetId, "read");
				if (grant.revokedAt) fail("GRANT_REVOKED");
				if (Date.parse(grant.expiresAt) <= Date.now()) fail("GRANT_EXPIRED");
				if (capabilities.some((c) => !grant.capabilities.includes(c))) fail("UNAUTHORIZED");
				const descriptor = await this.backend.describe();
				if (!descriptor.targets.some((t) => t.id === targetId)) fail("WRONG_TARGET");
				if (grant.revokedAt) fail("GRANT_REVOKED");
				if (Date.parse(grant.expiresAt) <= Date.now()) fail("GRANT_EXPIRED");
				const epoch = (this.store.data.leaseEpochs[targetId] ?? 0) + 1;
				const session: DeviceSession = {
					deviceSessionId: randomUUID(),
					deviceId: this.deviceId,
					principalId: p,
					targetId,
					grantId,
					grantRevision: grant.revision,
					leaseEpoch: epoch,
					capabilities,
					origin,
					expiresAt: new Date(Math.min(Date.now() + 300_000, Date.parse(grant.expiresAt))).toISOString(),
				};
				this.store.data.leaseEpochs[targetId] = epoch;
				this.store.data.sessions[session.deviceSessionId] = session;
				commit(session);
				return session;
			}
			case "device.sessions.close": {
				const session = this.session(p, request.params.deviceSessionId);
				this.store.data.leaseEpochs[session.targetId] = session.leaseEpoch + 1;
				commit({ closed: true });
				return { closed: true };
			}
			case "commands.submit": {
				const command = decodeCommand(request.params.commandBase64, { deviceId: this.deviceId, principalId: p });
				const key = commandKey(command);
				const existing = this.store.data.commands[key];
				if (existing) {
					if (existing.receipt.payloadSha256 !== commandDigest(request.params.commandBase64)) fail("COMMAND_CONFLICT");
					this.session(p, command.deviceSessionId);
					return existing.receipt;
				}
				const session = this.session(p, command.deviceSessionId);
				if (command.leaseEpoch !== session.leaseEpoch) fail("LEASE_STALE");
				const action = this.backend.actions[command.action];
				if (!action) throw new Error("UNSUPPORTED_OPERATION");
				if (!action.validate(command.arguments)) fail("INVALID_REQUEST");
				this.authorizeSession(session, action.capabilities, command.action);
				const resources = action.resources?.(command.arguments) ?? { readRoots: [], writeRoots: [] };
				this.authorizeResources(session, resources.readRoots, resources.writeRoots);
				if (action.mutatesDevice && this.writer) fail("BUSY");
				const acceptedAt = now();
				const receipt: CommandReceipt = {
					deviceId: this.deviceId,
					principalId: p,
					commandId: command.commandId,
					deviceSessionId: command.deviceSessionId,
					payloadSha256: commandDigest(request.params.commandBase64),
					state: "accepted",
					acceptedAt,
					updatedAt: acceptedAt,
				};
				const acceptedGrant = this.store.data.grants[session.grantId];
				if (!acceptedGrant) throw new Error("UNAUTHORIZED");
				this.store.data.commands[key] = {
					receipt,
					commandBase64: request.params.commandBase64,
					targetId: session.targetId,
					action: command.action,
					readRoots: [...resources.readRoots],
					writeRoots: [...resources.writeRoots],
				};
				commit(receipt);
				queueMicrotask(() => this.startDispatch(key));
				return receipt;
			}
			case "commands.status":
				return this.query(p, request.params.commandId);
			case "commands.cancel": {
				const { key, record } = this.record(p, request.params.commandId);
				this.grant(p, record.targetId, "exec", record.action);
				if (record.receipt.state === "accepted") {
					record.receipt.state = "cancelled";
					record.receipt.updatedAt = now();
					commit(record.receipt);
				} else if (record.receipt.state === "running") {
					const running = this.running.get(key);
					if (!running) throw new Error("OUTCOME_UNKNOWN");
					running.abort.abort();
					await running.done;
				}
				return record.receipt;
			}
			case "grants.revoke":
				this.store.revoke(p, request.params.grantId, false);
				commit({ revoked: true });
				return { revoked: true };
		}
	}
	/** Both direct and relay adapters call this one authenticated entry point. */
	async handle(envelope: unknown): Promise<SignedEnvelope> {
		this.assertHealthy();
		if (!Check(SignedEnvelopeSchema, envelope)) throw new Error("INVALID_REQUEST");
		const untrusted = JSON.parse(
			Buffer.from((envelope as SignedEnvelope).payloadBase64, "base64").toString("utf8"),
		) as Partial<RpcRequest>;
		if (untrusted.deviceId !== this.deviceId || typeof untrusted.principalId !== "string")
			throw new Error("WRONG_TARGET");
		const peer = this.store.data.peers[untrusted.principalId];
		if (!peer) throw new Error("UNPAIRED");
		const verified = verifyMessage(
			envelope,
			createPublicKey({ key: Buffer.from(peer, "base64"), format: "der", type: "spki" }),
			{ kind: "request", principalId: untrusted.principalId, deviceId: this.deviceId, now: Date.now() },
		);
		if (verified.kind !== "request") throw new Error("INVALID_REQUEST");
		const request = verified as RpcRequest;
		const requestKey = `${request.principalId}:${request.requestId}`;
		const requestDigest = digest((envelope as SignedEnvelope).payloadBase64);
		const active = this.requestsInFlight.get(requestKey);
		if (active) {
			if (active.digest !== requestDigest) throw new Error("COMMAND_CONFLICT");
			const answer = await active.response;
			this.assertHealthy();
			return answer;
		}
		const response = this.respond(request, requestDigest);
		this.requestsInFlight.set(requestKey, { digest: requestDigest, response });
		try {
			const answer = await response;
			this.assertHealthy();
			return answer;
		} finally {
			this.requestsInFlight.delete(requestKey);
		}
	}
	private async respond(request: RpcRequest, requestDigest: string): Promise<SignedEnvelope> {
		const mutates = [
			"device.sessions.open",
			"device.sessions.close",
			"commands.submit",
			"commands.cancel",
			"grants.revoke",
		].includes(request.method);
		const requestKey = `${request.principalId}:${request.requestId}`;
		const cached = this.store.data.requests[requestKey];
		const header = {
			protocol: "yonder.execution",
			version: 1,
			kind: "response",
			requestId: request.requestId,
			principalId: request.principalId,
			deviceId: this.deviceId,
			issuedAt: Date.now(),
			expiresAt: Date.now() + 60_000,
		} as const;
		let response: RpcResponse | undefined;
		let commitAttempted = false;
		const commit = (result: unknown) => {
			// Effect and replay receipt share one atomic state-file publication, before dispatch/response.
			commitAttempted = true;
			response = { ...header, ok: true, result: structuredClone(result) };
			this.store.data.requests[requestKey] = { digest: requestDigest, response };
			this.persist();
		};
		if (cached) {
			if (cached.digest !== requestDigest) throw new Error("COMMAND_CONFLICT");
			response = cached.response as RpcResponse;
		} else {
			try {
				const result = await this.operate(request, commit);
				if (!response) {
					if (mutates) commit(result);
					else response = { ...header, ok: true, result };
				}
			} catch (error) {
				if (commitAttempted) throw error;
				const raw = (error as Error).message;
				const code = (errorCodes.has(raw) ? raw : "INTERNAL_ERROR") as NonNullable<CommandReceipt["error"]>["code"];
				response = { ...header, ok: false, error: { code, message: code } };
				if (mutates) {
					this.store.data.requests[requestKey] = { digest: requestDigest, response };
					this.persist();
				}
			}
		}
		if (!response) throw new Error("INTERNAL_ERROR");
		this.assertHealthy();
		if (response.expiresAt <= Date.now())
			response = { ...response, issuedAt: Date.now(), expiresAt: Date.now() + 60_000 };
		return signMessage(response, this.store.key);
	}

	/** Loopback HTTP is test-only; private-network listening requires TLS. */
	async listenLoopback(port = 0): Promise<number> {
		return this.listenDirect({ host: "127.0.0.1", port });
	}
	async listenDirect(options: { host: string; port: number; tls?: { key: Buffer; cert: Buffer } }): Promise<number> {
		this.assertHealthy();
		if (this.server) fail("BUSY");
		if (isIP(options.host) === 0 || (options.host !== "127.0.0.1" && !options.tls)) fail("UNAUTHORIZED");
		const handler: RequestListener = async (req, res) => {
			if (req.method !== "POST" || req.url !== "/execution/v1") {
				res.writeHead(404).end();
				return;
			}
			try {
				const chunks: Buffer[] = [];
				let size = 0;
				for await (const chunk of req) {
					size += chunk.length;
					if (size > 1_500_000) fail("INVALID_REQUEST");
					chunks.push(chunk);
				}
				const answer = await this.handle(JSON.parse(Buffer.concat(chunks).toString("utf8")));
				res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(answer));
			} catch {
				res.writeHead(400).end();
			}
		};
		const server = options.tls ? createHttpsServer(options.tls, handler) : createServer(handler);
		this.server = server;
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(options.port, options.host, () => {
				server.off("error", reject);
				resolve();
			});
		});
		return (server.address() as { port: number }).port;
	}
	async close(): Promise<void> {
		if (this.server) {
			const server = this.server;
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
		const active = [...this.running.values()];
		for (const item of active) item.abort.abort();
		try {
			await Promise.all(active.map((item) => item.done));
		} finally {
			this.store.close();
		}
	}
}
