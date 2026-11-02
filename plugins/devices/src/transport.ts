import { type KeyObject, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
	type ExecutionError,
	type Grant,
	publicKeyId,
	type RpcRequest,
	type SignedEnvelope,
	signMessage,
	verifyMessage,
} from "@yonder/sdk";

/** Supplied by trusted pairing/connection management, never by model arguments. */
export interface RegisteredDevice {
	deviceId: string;
	name: string;
	controllerKey: KeyObject;
	deviceKey: KeyObject;
	grants: readonly Grant[];
	routes: readonly {
		kind: "direct" | "card";
		/** Adapter owns authenticated TLS/WSS and Card framing; return the inner signed envelope. */
		exchange(envelope: SignedEnvelope, signal: AbortSignal): Promise<unknown>;
	}[];
}
export type DeviceRegistry = () => Promise<readonly RegisteredDevice[]>;

export class RemoteError extends Error {
	constructor(
		readonly code: ExecutionError["code"],
		message: string,
	) {
		super(message);
	}
}

export class UnconfirmedRequest extends Error {
	constructor(
		readonly requestId: string,
		readonly connectivity: "offline" | "unknown",
		readonly diagnostic?: {
			stage: "exchange" | "authentication";
			reason: string;
			verification?: string;
			offsetMs?: number;
		},
	) {
		super("No authenticated response; inspect the existing operation before retrying");
	}
}

const queries = new Set<RpcRequest["method"]>([
	"device.describe",
	"device.apps.list",
	"device.ui.snapshot",
	"commands.status",
]);

async function verifyResponse(
	answer: unknown,
	key: KeyObject,
	expected: Parameters<typeof verifyMessage>[2],
	signal: AbortSignal,
	onWait: () => void,
) {
	for (;;) {
		signal.throwIfAborted();
		try {
			return verifyMessage(answer, key, { ...expected, now: Date.now() });
		} catch (error) {
			const cause = error instanceof Error ? error.cause : undefined;
			if (
				!cause ||
				typeof cause !== "object" ||
				!("verification" in cause) ||
				cause.verification !== "future" ||
				!("offsetMs" in cause) ||
				typeof cause.offsetMs !== "number" ||
				!Number.isSafeInteger(cause.offsetMs) ||
				cause.offsetMs <= 0
			)
				throw error;
			// Only our verifier can reach here, after signature, binding and all other time-window checks.
			// Wait for real local time, never adjust it or resend. The original route budget owns cancellation.
			onWait();
			await delay(Math.min(1_000, cause.offsetMs), undefined, { signal });
		}
	}
}

export async function rpc<M extends RpcRequest["method"]>(
	device: RegisteredDevice,
	method: M,
	params: Extract<RpcRequest, { method: M }>["params"],
	signal: AbortSignal,
): Promise<unknown> {
	signal.throwIfAborted();
	const requestId = randomUUID();
	const now = Date.now();
	const principalId = publicKeyId(device.controllerKey);
	const request = {
		protocol: "yonder.execution",
		version: 1,
		kind: "request",
		requestId,
		deviceId: device.deviceId,
		principalId,
		issuedAt: now,
		expiresAt: now + 60_000,
		method,
		params,
	} as RpcRequest;
	const envelope = signMessage(request, device.controllerKey);
	let diagnostic: UnconfirmedRequest["diagnostic"];
	// Only queries can fall through to another route. Lost submit ACKs are queried by command ID.
	for (const route of queries.has(method) ? device.routes : device.routes.slice(0, 1)) {
		const budget = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
		let stage: "exchange" | "authentication" = "exchange";
		let waitingForClock = false;
		try {
			budget.throwIfAborted();
			// Snapshot adapter output before verification; accessors cannot impersonate verifier errors.
			const answer = structuredClone(await route.exchange(envelope, budget));
			stage = "authentication";
			const response = await verifyResponse(
				answer,
				device.deviceKey,
				{
					kind: "response",
					principalId,
					deviceId: device.deviceId,
					requestId,
					now: Date.now(),
				},
				budget,
				() => {
					waitingForClock = true;
				},
			);
			if (response.kind !== "response") throw new Error("WRONG_TARGET");
			if (!response.ok) throw new RemoteError(response.error.code, response.error.message);
			return response.result;
		} catch (error) {
			if (error instanceof RemoteError) throw error;
			// Never log arbitrary transport messages: they may contain credentials or response bodies.
			const code = (error as NodeJS.ErrnoException | undefined)?.code;
			const message = error instanceof Error ? error.message : "";
			diagnostic = {
				stage,
				reason: budget.aborted
					? "aborted"
					: typeof code === "string" &&
							[
								"ECONNRESET",
								"ECONNREFUSED",
								"EPIPE",
								"ETIMEDOUT",
								"ENOTFOUND",
								"EAI_AGAIN",
								"EHOSTUNREACH",
								"ENETUNREACH",
								"ABORT_ERR",
							].includes(code)
						? code
						: /^(?:Execution HTTP status [0-9]{3}|INVALID_REQUEST|UNAUTHORIZED|WRONG_TARGET)$/.test(message)
							? message
							: "unconfirmed",
			};
			const cause = error instanceof Error ? error.cause : undefined;
			if (stage === "authentication" && message === "UNAUTHORIZED" && cause && typeof cause === "object") {
				const { verification, offsetMs } = cause as { verification?: unknown; offsetMs?: unknown };
				if (
					typeof verification === "string" &&
					["key-id", "principal", "signature", "invalid-now", "future", "expired", "invalid-window"].includes(
						verification,
					)
				) {
					diagnostic.verification = verification;
					if (
						(verification === "future" || verification === "expired") &&
						typeof offsetMs === "number" &&
						Number.isSafeInteger(offsetMs)
					)
						diagnostic.offsetMs = offsetMs;
				}
			}
			if (signal.aborted || waitingForClock) break;
		}
	}
	throw new UnconfirmedRequest(requestId, device.routes.length ? "unknown" : "offline", diagnostic);
}
