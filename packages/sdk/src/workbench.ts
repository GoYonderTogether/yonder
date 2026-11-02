import type { Capability, Level, SessionModels } from "./types.js";

/** Device IDs are execution identities; `local` means the selected Runtime, never the browser. */
export type WorkspaceResource = {
	deviceId: string;
	paths: string[];
};
export interface SessionOptions {
	model?: string;
	effort?: NonNullable<SessionModels["thinking"]> | "auto";
	permission?: string;
	resources?: WorkspaceResource[];
}
export type SessionWorkbenchOptions = {
	defaultWorkspace?: { deviceId: string; path: string };
	permission?: { id: string; level?: Level; capabilities: Capability[] };
	resources?: WorkspaceResource[];
};
