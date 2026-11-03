import type { ExecutionEnv } from "@yonder/sdk";
import type { RuntimeOptions as SharedRuntimeOptions } from "../types.js";

export type RuntimeOptions = Omit<SharedRuntimeOptions, "services"> & {
	envs?: Map<string, ExecutionEnv>;
	localEnvironment?: boolean | ((cwd: string) => ExecutionEnv);
};
