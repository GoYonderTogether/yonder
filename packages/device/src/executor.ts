import { createPublicKey } from "node:crypto";
import type { Server } from "node:http";
import type { Server as HttpsServer } from "node:https";
import {
	type CommandReceipt,
	commandKey,
	type DeviceSession,
	decodeCommand,
	type ExecutionCapability,
	type ExecutionError,
	type Grant,
	publicKeyId,
	type RpcRequest,
	type RpcResponse,
	type SignedEnvelope,
	SignedEnvelopeSchema,
	signMessage,
	verifyAttestation,
} from "@yonder/protocol";
import { Check } from "typebox/value";
import type { BackendProvider } from "./backend-provider.js";
import { type ExecutorDiagnostic, ExecutorDiagnostics, verifyRequest } from "./executor-auth.js";
import { operateRpc } from "./executor-commands.js";
import type { CommandDeps } from "./executor-deps.js";
import { serveExecution } from "./executor-http.js";
import { covered, digest, errorCodes, fail, GrantListeners, has, now } from "./executor-support.js";
import { type CommandRecord, ExecutorStore } from "./store.js";

export class DeviceExecutor {
	readonly store: ExecutorStore;
	private readonly requestsInFlight = new Map<string, { digest: string; response: Promise<SignedEnvelope> }>();
	private readonly running = new Map<string, { abort: AbortController; done: Promise<void> }>();
	private writer: string | undefined;
	private server: Server | HttpsServer | undefined;
	private faulted = false;
	private readonly verifying = new AbortController();
	private readonly diagnostics: ExecutorDiagnostics;
	private cloudKey: Buffer | undefined;
	private readonly grantListeners = new GrantListeners();
	constructor(
		home: string,
		readonly backend: BackendProvider,
		onDiagnostic: (diagnostic: ExecutorDiagnostic) => void = () => {},
	) {
		this.diagnostics = new ExecutorDiagnostics(onDiagnostic);
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
			this.diagnostics.persistence(error);
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
	/** The commands table's view of this executor: same methods, read at call time. */
	private commandDeps(): CommandDeps {
		return {
			store: this.store,
			backend: this.backend,
			deviceId: this.deviceId,
			grant: (principalId, targetId, capability, action) => this.grant(principalId, targetId, capability, action),
			session: (principalId, sessionId) => this.session(principalId, sessionId),
			authorizeSession: (session, capabilities, action) => this.authorizeSession(session, capabilities, action),
			authorizeResources: (session, readRoots, writeRoots) => this.authorizeResources(session, readRoots, writeRoots),
			record: (principalId, commandId) => this.record(principalId, commandId),
			query: (principalId, commandId) => this.query(principalId, commandId),
			running: this.running,
			busy: () => !!this.writer,
			startDispatch: (key) => this.startDispatch(key),
		};
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
	/** Both direct and relay adapters call this one authenticated entry point. */
	async handle(envelope: unknown, signal?: AbortSignal): Promise<SignedEnvelope> {
		const budget = AbortSignal.any([this.verifying.signal, AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]);
		budget.throwIfAborted();
		this.assertHealthy();
		envelope = structuredClone(envelope);
		if (!Check(SignedEnvelopeSchema, envelope)) throw new Error("INVALID_REQUEST");
		const untrusted = JSON.parse(
			Buffer.from((envelope as SignedEnvelope).payloadBase64, "base64").toString("utf8"),
		) as Partial<RpcRequest>;
		if (untrusted.deviceId !== this.deviceId || typeof untrusted.principalId !== "string")
			throw new Error("WRONG_TARGET");
		const peer = this.store.data.peers[untrusted.principalId];
		if (!peer) throw new Error("UNPAIRED");
		const verified = await verifyRequest(
			envelope,
			createPublicKey({ key: Buffer.from(peer, "base64"), format: "der", type: "spki" }),
			{ kind: "request", principalId: untrusted.principalId, deviceId: this.deviceId, now: Date.now() },
			budget,
			this.diagnostics,
		);
		budget.throwIfAborted();
		this.assertHealthy();
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
	/**
	 * Cloud-introduced pairing. The envelope verifies against the controller key carried in the
	 * request (never an already-paired record); the cloud attestation proves this executor's own
	 * registration and names the same controller. What is actually granted is decided here.
	 */
	async introduce(envelope: unknown, attestation: unknown, signal?: AbortSignal): Promise<SignedEnvelope> {
		const budget = AbortSignal.any([this.verifying.signal, AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]);
		budget.throwIfAborted();
		this.assertHealthy();
		const claimed = structuredClone(envelope);
		if (!Check(SignedEnvelopeSchema, claimed)) throw new Error("INVALID_REQUEST");
		const untrusted = JSON.parse(
			Buffer.from((claimed as SignedEnvelope).payloadBase64, "base64").toString("utf8"),
		) as Partial<RpcRequest> & { params?: { controllerPublicKey?: unknown } };
		if (untrusted.method !== "device.introduce" || untrusted.kind !== "request" || untrusted.deviceId !== this.deviceId)
			throw new Error("WRONG_TARGET");
		const encodedKey = untrusted.params?.controllerPublicKey;
		if (typeof encodedKey !== "string" || typeof untrusted.requestId !== "string") throw new Error("INVALID_REQUEST");
		const key = createPublicKey({ key: Buffer.from(encodedKey, "base64"), format: "der", type: "spki" });
		const principalId = publicKeyId(key);
		if (principalId !== untrusted.principalId)
			throw new Error("UNAUTHORIZED", { cause: { verification: "principal" } });
		const verified = await verifyRequest(
			claimed,
			key,
			{ kind: "request", principalId, deviceId: this.deviceId, now: Date.now() },
			budget,
			this.diagnostics,
		);
		budget.throwIfAborted();
		if (verified.kind !== "request" || verified.method !== "device.introduce") throw new Error("INVALID_REQUEST");
		// Every refusal after this point is a signed answer, so the controller learns the real reason
		// instead of waiting for a timeout it cannot interpret.
		const refuse = (code: ExecutionError["code"]): SignedEnvelope => {
			const issuedAt = Date.now();
			return signMessage(
				{
					protocol: "yonder.execution",
					version: 1,
					kind: "response",
					requestId: untrusted.requestId as string,
					principalId,
					deviceId: this.deviceId,
					issuedAt,
					expiresAt: issuedAt + 60_000,
					ok: false,
					error: { code, message: code },
				},
				this.store.key,
			);
		};
		if (this.store.pairingPolicy === "manual-only") return refuse("UNPAIRED");
		const cloud = this.store.data.cloud;
		if (!cloud || !this.cloudKey) return refuse("UNPAIRED");
		let claim: ReturnType<typeof verifyAttestation>;
		try {
			claim = verifyAttestation(attestation, this.cloudKey, Date.now());
		} catch {
			// A forged, expired or malformed claim is answered, not left to time out.
			return refuse("UNAUTHORIZED");
		}
		if (
			claim.ownerId !== cloud.ownerId ||
			claim.cloudDeviceId !== cloud.cloudDeviceId ||
			claim.executorDeviceId !== this.deviceId ||
			claim.action !== "introduce" ||
			claim.subject !== principalId
		)
			return refuse("UNAUTHORIZED");
		const { params } = verified as RpcRequest & { method: "device.introduce" };
		if (params.botId !== null && !this.store.allows(params.botId, cloud.cloudDeviceId)) return refuse("UNAUTHORIZED");
		// An owner's explicit revocation wins over a repeated introduction.
		if (this.store.wasRevoked(params.botId)) return refuse("GRANT_REVOKED");
		const descriptor = await this.backend.describe();
		if (descriptor.deviceId !== this.deviceId) return refuse("WRONG_TARGET");
		if (!params.actions.every((name) => this.backend.actions[name] !== undefined))
			return refuse("UNSUPPORTED_OPERATION");
		if (!params.targetIds.every((id) => descriptor.targets.some((target) => target.id === id)))
			return refuse("UNSUPPORTED_OPERATION");
		const granted = this.store.introduce({
			principalId,
			publicKey: encodedKey,
			botId: params.botId,
			label: params.label,
			capabilities: params.capabilities,
			targetIds: params.targetIds,
			actions: params.actions,
			readRoots: params.readRoots,
			writeRoots: params.writeRoots,
		});
		if (!granted) return refuse("UNAUTHORIZED");
		this.grantListeners.notify();
		const issuedAt = Date.now();
		return signMessage(
			{
				protocol: "yonder.execution",
				version: 1,
				kind: "response",
				requestId: untrusted.requestId as string,
				principalId,
				deviceId: this.deviceId,
				issuedAt,
				expiresAt: issuedAt + 60_000,
				ok: true,
				result: { grant: granted, principalId },
			},
			this.store.key,
		);
	}
	/** Owner-side revocation arriving from the relay or the management CLI. */
	revokeGrant(grantId: string): void {
		const grant = this.store.data.grants[grantId];
		this.store.revokeAny(grantId);
		// Remember the Bot withdrawal so the next refresh cannot silently re-introduce it.
		if (grant?.botId) {
			this.store.data.revokedBots = { ...this.store.data.revokedBots, [grant.botId]: new Date().toISOString() };
			this.store.save();
		}
		this.grantListeners.notify();
	}
	applyAllowance(botId: string, devices: string[] | null): void {
		this.store.applyAllowance(botId, devices);
		this.grantListeners.notify();
	}
	/** What the inbox relay connection learned about this executor's own cloud registration. */
	rememberCloud(identity: { ownerId: string; cloudDeviceId: string }, cloudKey: Buffer): void {
		this.store.rememberCloud(identity);
		this.cloudKey = cloudKey;
	}
	summaries(): Grant[] {
		return this.store.summaries();
	}
	/** Called once per grant-set change; the relay connection reports the new summaries. */
	onGrantsChanged(listener: () => void): () => void {
		return this.grantListeners.add(listener);
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
		const issuedAt = Date.now();
		const header = {
			protocol: "yonder.execution",
			version: 1,
			kind: "response",
			requestId: request.requestId,
			principalId: request.principalId,
			deviceId: this.deviceId,
			issuedAt,
			expiresAt: issuedAt + 60_000,
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
				const result = await operateRpc(this.commandDeps(), request, commit);
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
		const now = Date.now();
		if (response.expiresAt <= now) response = { ...response, issuedAt: now, expiresAt: now + 60_000 };
		return signMessage(response, this.store.key);
	}
	/** Loopback HTTP is test-only; private-network listening requires TLS. */
	async listenLoopback(port = 0): Promise<number> {
		return this.listenDirect({ host: "127.0.0.1", port });
	}
	async listenDirect(options: { host: string; port: number; tls?: { key: Buffer; cert: Buffer } }): Promise<number> {
		this.assertHealthy();
		if (this.server) fail("BUSY");
		return serveExecution(
			(envelope, signal) => this.handle(envelope, signal),
			options,
			(server) => {
				this.server = server;
			},
		);
	}
	async close(): Promise<void> {
		this.verifying.abort();
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
