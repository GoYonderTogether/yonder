import { hostname } from "node:os";
import { join } from "node:path";
import { detectOpenclaw, installPlugin, uninstallPlugin } from "./openclaw.js";
import { cloudBase, startPairing, waitForPairing } from "./pairing.js";
import { clearConfig, openBrowser, readConfig, writeConfig } from "./state.js";

export const DEFAULT_ENDPOINT = "https://yonderbot.net";
/** The plugin id OpenClaw knows this connector by. */
export const PLUGIN_ID = "yonder-connector";

export interface OpenclawConnectOptions {
	/** Cloud origin; defaults to the public site. Also settable with `--endpoint` or `YONDER_ENDPOINT`. */
	endpoint?: string;
	/** Install spec: a local plugin directory (or `npm-pack:`/`clawhub:` spec accepted by openclaw). */
	spec?: string;
	/** Print the pairing URL instead of opening a browser. */
	noOpen?: boolean;
	/** Milliseconds between polls while waiting for the human to confirm. */
	intervalMs?: number;
	env?: NodeJS.ProcessEnv;
	log?: (message: string) => void;
	browser?: (url: string) => void;
}

export interface OpenclawConnectResult {
	endpoint: string;
	stateDir: string;
}

/**
 * Install the connector plugin into OpenClaw and pair this computer (spec 23 §6).
 * OpenClaw plugins live in its managed plugin root; `openclaw plugins install`
 * handles local paths, npm and ClawHub specs itself, so the installer only runs
 * that command and pairs.
 */
export async function connectOpenclaw(options: OpenclawConnectOptions = {}): Promise<OpenclawConnectResult> {
	const log = options.log ?? ((message: string) => process.stdout.write(`${message}\n`));
	const env = options.env ?? process.env;
	const endpoint = cloudBase(options.endpoint ?? env.YONDER_ENDPOINT ?? DEFAULT_ENDPOINT);
	const install = detectOpenclaw({ env });
	log(`OpenClaw ${install.version ? install.version : "（版本未知）"}，state ${install.stateDir}。`);
	installPlugin({ launcher: install.launcher, spec: options.spec ?? PLUGIN_ID, env });
	log(`连接器已通过 openclaw plugins install 装入（${options.spec ?? PLUGIN_ID}）。`);
	const stateDir = openclawStateDir(install.stateDir);
	// A previous pairing is replaced only after a new one succeeds, so a failed
	// run cannot lock the user out.
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
	log("重启 OpenClaw gateway 后，这台电脑和它的 Bot 会出现在网页的工作页。");
	if (existing && existing.endpoint !== endpoint) log(`注意：这次配对替换了原来指向 ${existing.endpoint} 的连接。`);
	return { endpoint, stateDir };
}

export interface OpenclawRemoveOptions {
	env?: NodeJS.ProcessEnv;
	log?: (message: string) => void;
	run?: (
		command: string,
		args: string[],
		env: NodeJS.ProcessEnv,
	) => { status: number | null; stdout: string; stderr: string };
}

/** Uninstall the plugin and clear the connector's own state; OpenClaw itself is untouched. */
export function removeOpenclaw(options: OpenclawRemoveOptions = {}): { removed: string[]; pluginDir?: string } {
	const log = options.log ?? ((message: string) => process.stdout.write(`${message}\n`));
	const env = options.env ?? process.env;
	const install = detectOpenclaw({ env });
	try {
		uninstallPlugin({
			launcher: install.launcher,
			env,
			...(options.run ? { run: options.run } : {}),
		});
		log(`已通过 openclaw plugins uninstall 移除 ${PLUGIN_ID}。`);
	} catch (error) {
		log(`${error instanceof Error ? error.message : "卸载失败"}（继续清除本地连接状态）`);
	}
	const removed = clearConfig(openclawStateDir(install.stateDir));
	log(removed.length ? `已清除连接状态：${removed.join("、")}` : "没有需要清除的连接状态。");
	return { removed };
}

/** Where the OpenClaw connector keeps its own state: `~/.openclaw/yonder/`. */
export function openclawStateDir(stateDir: string): string {
	return join(stateDir, "yonder");
}
