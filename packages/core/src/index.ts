export { type GatewaySettings, gatewaySettings, setAccessTokenHash } from "./config/gateway.js";
export type { ControlConnection, ControlRequest } from "./control/index.js";
export { cliChannelEndpoint, controlEndpoint, observeControl, requestControl, serveControl } from "./control/index.js";
export type {
	AwakeSnapshot,
	ErrorCode,
	GatewayHost,
	HostCtx,
	MethodDef,
	MethodFacts,
	Principal,
	Scope,
	StreamDef,
} from "./control/methods.js";
export { allScopes, controlHandler, MethodError, PROTOCOL, registry } from "./control/methods.js";
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
export type { RuntimeActivityExecution, TerminalUpdate } from "./runtime/index.js";
export { attachmentFromPath } from "./runtime/index.js";
export { createStatusSurface, type StatusSnapshot, type StatusSurface } from "./status/index.js";
export { statusPath } from "./status/snapshot.js";
