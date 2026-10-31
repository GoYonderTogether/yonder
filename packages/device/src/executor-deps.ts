import type { CommandReceipt, DeviceSession, ExecutionCapability } from "@yonder/protocol";
import type { BackendProvider } from "./backend-provider.js";
import type { CommandRecord, ExecutorStore } from "./store.js";

/** Everything the RPC method table needs from DeviceExecutor, without widening its private surface. */
export interface CommandDeps {
	store: ExecutorStore;
	backend: BackendProvider;
	deviceId: string;
	grant(principalId: string, targetId: string, capability: ExecutionCapability, action?: string): unknown;
	session(principalId: string, sessionId: string): DeviceSession;
	authorizeSession(session: DeviceSession, capabilities: readonly ExecutionCapability[], action?: string): void;
	authorizeResources(session: DeviceSession, readRoots: string[], writeRoots: string[]): void;
	record(principalId: string, commandId: string): { key: string; record: CommandRecord };
	query(principalId: string, commandId: string): CommandReceipt;
	running: Map<string, { abort: AbortController; done: Promise<void> }>;
	/** A mutating command is already running: `this.writer !== undefined`. */
	busy(): boolean;
	startDispatch(key: string): void;
}
