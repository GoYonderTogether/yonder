export type { ControlRequest } from "./control/index.js";
export { requestControl, serveControl } from "./control/index.js";
export type { Kernel, KernelLog, LoginInteraction } from "./kernel/index.js";
export {
	initHome,
	inspectHome,
	inspectSkills,
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
