import { type KeyObject, randomUUID } from "node:crypto";
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
	const budget = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
	// Only queries can fall through to another route. Lost submit ACKs are queried by command ID.
	for (const route of queries.has(method) ? device.routes : device.routes.slice(0, 1)) {
		try {
			budget.throwIfAborted();
			const response = verifyMessage(await route.exchange(envelope, budget), device.deviceKey, {
				kind: "response",
				principalId,
				deviceId: device.deviceId,
				requestId,
				now: Date.now(),
			});
			if (response.kind !== "response") throw new Error("WRONG_TARGET");
			if (!response.ok) throw new RemoteError(response.error.code, response.error.message);
			return response.result;
		} catch (error) {
			if (error instanceof RemoteError) throw error;
			if (budget.aborted) break;
		}
	}
	throw new UnconfirmedRequest(requestId, device.routes.length ? "unknown" : "offline");
}
