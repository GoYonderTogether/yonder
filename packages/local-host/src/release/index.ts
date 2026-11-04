export { readChangelog, readDocs } from "@yonder/local-host/release/docs";
export { checkRelease, releaseInfo } from "@yonder/local-host/release/info";
export { managedVersionLink, unlinkManagedVersionLink } from "@yonder/local-host/release/install";
export { installedService, unloadService } from "@yonder/local-host/release/installation";
export {
	launcher,
	linuxServiceUnit,
	serviceLauncher,
	servicePlist,
	statusPlist,
	windowsLauncher,
	windowsServiceLauncher,
	windowsWorkspaceLauncher,
	workspaceBins,
	workspaceLauncher,
} from "@yonder/local-host/release/launchers";
export * from "@yonder/local-host/release/names";
export { manageService, type ServiceAction } from "@yonder/local-host/release/service";
export { type UpdateOptions, updateRelease, verifyRelease } from "@yonder/local-host/release/update";
export { compareVersions, latestRelease, selectChangelog } from "@yonder/local-host/release/versions";
