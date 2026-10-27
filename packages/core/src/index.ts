export type { ControlConnection, ControlRequest } from "./control/index.js";
export { observeControl, requestControl, serveControl } from "./control/index.js";
export type { Kernel, KernelLog, LoginInteraction } from "./kernel/index.js";
export {
	initHome,
	inspectHome,
	inspectSkills,
	loginProvider,
	manageCredentialSlots,
	manageHome,
	offlineQuery,
	openKernel,
	packageVersion,
	setNamedCredential,
} from "./kernel/index.js";
export {
	checkRelease,
	compareVersions,
	installedService,
	manageService,
	readChangelog,
	readDocs,
	releaseInfo,
	updateRelease,
} from "./release/index.js";
export type { TerminalUpdate } from "./runtime/index.js";

export { attachmentFromPath } from "./runtime/index.js";
