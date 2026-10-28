import type { SessionSettledEv } from "@yonder/sdk";
import type { RuntimeOptions as BaseRuntimeOptions } from "./types.js";

export type RuntimeOptions = BaseRuntimeOptions & {
	onSessionSettled?(event: SessionSettledEv): Promise<void>;
};
