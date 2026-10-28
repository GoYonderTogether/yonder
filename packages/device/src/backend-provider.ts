import type { AppInventory, DeviceDescriptor, DeviceSession, ExecutionCapability, UiSnapshot } from "@yonder/protocol";

/** A provider reports real device facts and owns its driver. Authority, persistence and locks stay in the executor. */
export interface BackendAction {
	capabilities: readonly ExecutionCapability[];
	mutatesDevice: boolean;
	validate(arguments_: Record<string, unknown>): boolean;
	/** Canonical filesystem resources touched by this action; required for path-based actions. */
	resources?(arguments_: Record<string, unknown>): { readRoots: string[]; writeRoots: string[] };
	execute(
		arguments_: Record<string, unknown>,
		context: { session: DeviceSession; signal: AbortSignal },
	): Promise<unknown>;
}

export interface BackendProvider {
	describe(): Promise<DeviceDescriptor>;
	apps(targetId: string): Promise<AppInventory>;
	snapshot(session: DeviceSession): Promise<UiSnapshot>;
	actions: Readonly<Record<string, BackendAction>>;
}
