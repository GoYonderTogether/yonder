import type { Capability, ExecutionEnv, YEvent } from "./types.js";
import type { WorkspaceResource } from "./workbench.js";

export interface ToolContext {
	agent: string | null;
	profile: string;
	session: string;
	runId?: string;
	autoReplySource?: string;
	capabilities: Capability[];
	/** Effective scope from the real run configuration, not inferred from input events. */
	channelInstances?: string[];
	/** Explicit owner-selected device/directory scope frozen with this run. Omitted means inherited grants. */
	resources?: WorkspaceResource[];
	env: ExecutionEnv;
	event?: YEvent;
	/** Actual inputs of this native run, including placed steer inputs. */
	events?: YEvent[];
	signal: AbortSignal;
	cacheToolOutput?(text: string, options?: { extension?: string }): Promise<string>;
	cacheToolOutputStream?(chunks: AsyncIterable<Uint8Array>, options?: { extension?: string }): Promise<string>;
	/** Authorize a file write using the active run policy. */
	authorizeFileWrite?(path: string): Promise<void>;
}
