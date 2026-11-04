import type { Runtime as RuntimeInstance, Runtime as SharedRuntime } from "../../runtime/index.js";
import { openNodeRuntime } from "../open-runtime.js";
import type { RuntimeOptions } from "../runtime-options.js";

export type Runtime = RuntimeInstance;
export const Runtime = {
	async open(options: RuntimeOptions): Promise<SharedRuntime> {
		const runtime = await openNodeRuntime({ ...options, localEnvironment: options.localEnvironment ?? true });
		let stopped = false;
		let pending: Promise<void> | undefined;
		const timer = setInterval(() => {
			if (stopped || pending) return;
			pending = runtime
				.maintenance()
				.catch((error) => options.onReport?.(error))
				.finally(() => {
					pending = undefined;
				});
		}, 15_000);
		timer.unref();
		const close = runtime.close.bind(runtime);
		runtime.close = async () => {
			stopped = true;
			clearInterval(timer);
			try {
				await pending;
			} finally {
				await close();
			}
		};
		return runtime;
	},
};
export { inspectToolCatalog } from "../../runtime/catalog.js";
export { submissionOutcome } from "../../runtime/docs.js";
export type { TerminalUpdate } from "../../runtime/terminal.js";
export { readTranscript } from "../../runtime/transcript.js";
export type * from "../../types.js";
export { canonicalPath, workspaceFiles } from "../../workspace-files.js";
export type { RuntimeOptions } from "../runtime-options.js";
export { attachmentFromPath } from "./attachments.js";
export { type LoginInteraction, loginProvider } from "./auth.js";
export { credentialPath, FileCredentials } from "./credentials.js";
export { localEnvironment } from "./env.js";
export { openNodeRuntime };
