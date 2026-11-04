import { hostname } from "node:os";
import { chooseProfile, type DshInstall, detectDsh, installBundle, removeBundle } from "./dsh.js";
import { cloudBase, startPairing, waitForPairing } from "./pairing.js";
import { clearConfig, dshStateDir, openBrowser, readConfig, writeConfig } from "./state.js";

export const DEFAULT_ENDPOINT = "https://yonderbot.net";
/** The npm package this installer puts into the profile. */
export const BUNDLE_NAME = "@yonder/dsh-connector";

export interface ConnectOptions {
	/** Cloud origin; defaults to the public site. Also settable with `--endpoint` or `YONDER_ENDPOINT`. */
	endpoint?: string;
	/** Explicit DSH profile; otherwise the single existing non-desktop profile. */
	profile?: string;
	/** Install spec: a tarball path or registry name; defaults to `BUNDLE_NAME@latest`. */
	spec?: string;
	/** Print the pairing URL instead of opening a browser (the DSH agent path has no browser handle). */
	noOpen?: boolean;
	/** Milliseconds between polls while waiting for the human to confirm. */
	intervalMs?: number;
	env?: NodeJS.ProcessEnv;
	log?: (message: string) => void;
	browser?: (url: string) => void;
}

export interface ConnectResult {
	endpoint: string;
	profile: string;
	stateDir: string;
	botsWarned?: string;
}

/**
 * Install the connector into a DSH profile and pair this computer with the account the
 * human confirms in the browser (spec 23 §6). Every step either happens for real or
 * reports why it did not; nothing is skipped silently.
 */
export async function connectDsh(options: ConnectOptions = {}): Promise<ConnectResult> {
	const log = options.log ?? ((message: string) => process.stdout.write(`${message}\n`));
	const env = options.env ?? process.env;
	const endpoint = cloudBase(options.endpoint ?? env.YONDER_ENDPOINT ?? DEFAULT_ENDPOINT);
	const install = detectDsh({ env });
	const profile = chooseProfile(install.profiles, options.profile ?? env.YONDER_PROFILE);
	log(`DeepSeek Harness ${describe(install)}`);
	log(
		`安装到 profile「${profile}」：${install.launcher} plugin --profile ${profile} add ${options.spec ?? `${BUNDLE_NAME}@latest`}`,
	);
	installBundle({
		launcher: install.launcher,
		profile,
		spec: options.spec ?? `${BUNDLE_NAME}@latest`,
		env,
	});
	const stateDir = dshStateDir(install.home);
	// A previous pairing is replaced only after a new one succeeds, so a failed run cannot lock the user out.
	const existing = readConfig(stateDir);
	const controller = new AbortController();
	const code = await startPairing({ endpoint, name: hostname(), kind: "harness", signal: controller.signal });
	log(`请在浏览器确认这台电脑：${code.url}`);
	if (options.noOpen) log("（未自动打开浏览器；上面的链接请在已登录的浏览器中打开）");
	else (options.browser ?? openBrowser)(code.url);
	const token = await waitForPairing({
		endpoint,
		code: code.code,
		signal: controller.signal,
		...(options.intervalMs === undefined ? {} : { intervalMs: options.intervalMs }),
	});
	writeConfig(stateDir, { endpoint, deviceToken: token });
	log(`已绑定到 ${endpoint}；设备令牌保存在 ${stateDir}/config.json（0600）。`);
	log("重启 DeepSeek Harness 后，这台电脑和它的 Bot 会出现在网页的工作页。");
	if (existing && existing.endpoint !== endpoint) log(`注意：这次配对替换了原来指向 ${existing.endpoint} 的连接。`);
	return { endpoint, profile, stateDir };
}

export interface RemoveOptions {
	profile?: string;
	env?: NodeJS.ProcessEnv;
	log?: (message: string) => void;
}

/** Uninstall the bundle and clear the connector's own state; the harness itself is untouched. */
export function removeDsh(options: RemoveOptions = {}): { profile?: string; removed: string[] } {
	const log = options.log ?? ((message: string) => process.stdout.write(`${message}\n`));
	const env = options.env ?? process.env;
	const install = detectDsh({ env });
	const profile = install.profiles.length
		? chooseProfile(install.profiles, options.profile ?? env.YONDER_PROFILE)
		: undefined;
	if (profile) {
		try {
			removeBundleFor(install, profile, env);
			log(`已从 profile「${profile}」移除 ${BUNDLE_NAME}。`);
		} catch (error) {
			log(`${error instanceof Error ? error.message : "卸载失败"}（继续清除本地连接状态）`);
		}
	} else log("没有可用的 DSH profile；只清除本地连接状态。");
	const removed = clearConfig(dshStateDir(install.home));
	log(removed.length ? `已清除连接状态：${removed.join("、")}` : "没有需要清除的连接状态。");
	return { ...(profile ? { profile } : {}), removed };
}

function removeBundleFor(install: DshInstall, profile: string, env: NodeJS.ProcessEnv): void {
	removeBundle({ launcher: install.launcher, profile, name: BUNDLE_NAME, env });
}

function describe(install: DshInstall): string {
	return `${install.version ? `v${install.version}` : "（版本未知）"}，home ${install.home}，profile ${install.profiles.join("、") || "（无）"}`;
}
