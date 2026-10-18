export type { ControlConnection, ControlRequest } from "./control/index.js";
export { observeControl, requestControl, serveControl } from "./control/index.js";
export type { Kernel, KernelLog, LoginInteraction } from "./kernel/index.js";
export {
	initHome,
	inspectHome,
	inspectSkills,
	manageHome,
	loginProvider,
	offlineQuery,
	openKernel,
	packageVersion,
} from "./kernel/index.js";
export {
	compareVersions,
	manageService,
	readChangelog,
	readDocs,
	releaseInfo,
	updateRelease,
} from "./release/index.js";
export type { TerminalUpdate } from "./runtime/index.js";

export { attachmentFromPath } from "./runtime/index.js";
