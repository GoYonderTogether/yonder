import { homedir, userInfo } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { MigrateOptions } from "./migrate.js";

/** `<share>/yonder/home` is the default layout; a custom home keeps its legacy sibling next to it. */
const legacyShare = (home: string) =>
	basename(home) === "home" && basename(dirname(home)) === "yonder" ? dirname(dirname(home)) : dirname(home);

/**
 * The passwd home ignores HOME, so a faked or copied HOME (and any YONDER_HOME override) never looks like the
 * default installation whose launchd/systemd jobs migrate may rename.
 */
function isDefaultHome(home: string) {
	try {
		return home === join(userInfo().homedir, ".local/share/yonder/home");
	} catch {
		return false;
	}
}

export function defaultMigrateOptions(env: NodeJS.ProcessEnv = process.env): MigrateOptions {
	const custom = env.YONDER_HOME ? resolve(env.YONDER_HOME) : undefined;
	const share = custom ? legacyShare(custom) : join(homedir(), ".local/share");
	const newHome = custom ?? join(share, "yonder/home");
	return {
		oldHome: join(share, "yonder-harness/home"),
		newHome,
		// A custom home owns no install root: ~/.yonder-harness belongs to the default installation.
		...(custom ? {} : { oldInstall: join(homedir(), ".yonder-harness"), newInstall: join(share, "yonder/install") }),
		...(process.platform === "darwin"
			? { launchd: { daemons: "/Library/LaunchDaemons", helpers: "/Library/PrivilegedHelperTools" } }
			: {}),
		services: isDefaultHome(newHome),
	};
}
