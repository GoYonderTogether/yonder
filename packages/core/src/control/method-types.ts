import type { Static, TSchema } from "typebox";
import type { Kernel } from "../kernel/index.js";
import type { releaseInfo } from "../release/index.js";
/** Protocol version of the method registry / gateway wire format (contracts.md §5). */
export const PROTOCOL = 1;

export type Scope = "read" | "write" | "admin";
export const allScopes: Scope[] = ["read", "write", "admin"];
export type ErrorCode =
	| "unknown_method"
	| "forbidden"
	| "invalid_params"
	| "not_found"
	| "conflict"
	| "unavailable"
	| "error";

export class MethodError extends Error {
	constructor(
		public readonly code: ErrorCode,
		message: string,
	) {
		super(message);
		this.name = "MethodError";
	}
}

export interface Principal {
	id: string;
	/** Where the call arrived from; `local` methods are refused anywhere but the control socket. */
	transport: "socket" | "gateway";
	kind: "local" | "remote";
	scopes: Scope[];
}

export interface GatewayHost {
	/** Mint a one-time login ticket. */
	ticket(): { token: string; expiresAt: string; port: number; basePath: string };
}

/** What the daemon injects so methods do not close over the CLI layer. */
export interface HostCtx {
	kernel: Kernel;
	home: string;
	principal: Principal;
	releaseInfo(): Promise<Awaited<ReturnType<typeof releaseInfo>>>;
	awakeStatus(): AwakeSnapshot;
	stop(): void;
	gateway?: GatewayHost | undefined;
}

/** Opaque awake-service snapshot owned by the CLI layer; passed through unchanged. */
export type AwakeSnapshot = Record<string, unknown>;
export type LegacyFrame = Record<string, unknown>;

export interface StreamDef {
	/** `ev.type` of the frames this stream emits; frame `data` is the value passed to `emit`. */
	type: string;
	resumable: boolean;
	/** Shape of the control.sock line for this stream (unchanged from before the registry). */
	legacyFrame?(params: Record<string, unknown>, value: unknown): LegacyFrame;
}

export interface MethodDef<P extends TSchema = TSchema> {
	name: string;
	scope: Scope;
	params: P;
	stream?: StreamDef;
	local?: true;
	since: number;
	handler(
		params: Static<P>,
		ctx: HostCtx,
		signal: AbortSignal,
		emit: (value: unknown) => Promise<void>,
	): Promise<unknown>;
}
