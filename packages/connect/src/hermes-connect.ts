import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { copyPlugin, detectHermes, removePlugin, removePluginDir } from "./hermes.js";
import { cloudBase, startPairing, waitForPairing } from "./pairing.js";
import { clearConfig, hermesStateDir, openBrowser, readConfig, writeConfig } from "./state.js";

export const DEFAULT_ENDPOINT = "https://yonderbot.net";
/** The drop-in plugin directory name Hermes discovers. */
export const PLUGIN_NAME = "yonder-connector";

export interface HermesConnectOptions {
	/** Cloud origin; defaults to the public site. Also settable with `--endpoint` or `YONDER_ENDPOINT`. */
	endpoint?: string;
	/** Install spec: a local plugin directory. Remote git sources are accepted by hermes itself. */
	spec?: string;
	/** Print the pairing URL instead of opening a browser. */
	noOpen?: boolean;
	/** Milliseconds between polls while waiting for the human to confirm. */
	intervalMs?: number;
	env?: NodeJS.ProcessEnv;
	log?: (message: string) => void;
	browser?: (url: string) => void;
}

export interface HermesConnectResult {
	endpoint: string;
	stateDir: string;
	pluginDir: string;
}

/**
 * Install the connector plugin into Hermes and pair this computer with the
 * account the human confirms in the browser (spec 23 §6). Every step either
 * happens for real or reports why it did not; nothing is skipped silently.
 */
export async function connectHermes(options: HermesConnectOptions = {}): Promise<HermesConnectResult> {
	const log = options.log ?? ((message: string) => process.stdout.write(`${message}\n`));
	const env = options.env ?? process.env;
	const endpoint = cloudBase(options.endpoint ?? env.YONDER_ENDPOINT ?? DEFAULT_ENDPOINT);
	const install = detectHermes({ env });
	log(`Hermes Agent ${install.version ? `v${install.version}` : "（版本未知）"}，home ${install.home}。`);
	const pluginDir = copyPlugin(install.home, options.spec ?? defaultSpec());
	log(`连接器已装入 ${pluginDir}（drop-in，Hermes 下次启动时发现）。`);
	const stateDir = hermesStateDir(install.home);
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
	log("重启 Hermes gateway 后，这台电脑和它的 Bot 会出现在网页的工作页。");
	if (existing && existing.endpoint !== endpoint) log(`注意：这次配对替换了原来指向 ${existing.endpoint} 的连接。`);
	return { endpoint, stateDir, pluginDir };
}

export interface HermesRemoveOptions {
	env?: NodeJS.ProcessEnv;
	log?: (message: string) => void;
	run?: (
		command: string,
		args: string[],
		env: NodeJS.ProcessEnv,
	) => { status: number | null; stdout: string; stderr: string };
}

/** Uninstall the plugin and clear the connector's own state; Hermes itself is untouched. */
export function removeHermes(options: HermesRemoveOptions = {}): { pluginDir?: string; removed: string[] } {
	const log = options.log ?? ((message: string) => process.stdout.write(`${message}\n`));
	const env = options.env ?? process.env;
	const install = detectHermes({ env });
	try {
		removePlugin(install.launcher, env, options.run);
		log("已通过 hermes plugins remove 注销连接器。");
	} catch (error) {
		log(`${error instanceof Error ? error.message : "卸载失败"}（继续清除本地连接状态）`);
	}
	const pluginDir = removePluginDir(install.home);
	log(pluginDir ? `已删除连接器目录 ${pluginDir}。` : "没有需要删除的连接器目录。");
	const removed = clearConfig(hermesStateDir(install.home));
	log(removed.length ? `已清除连接状态：${removed.join("、")}` : "没有需要清除的连接状态。");
	return { ...(pluginDir ? { pluginDir } : {}), removed };
}

function defaultSpec(): string {
	// The bundled connector source ships inside the published @yonder/connect
	// package (files: ./hermes-connector).
	return join(dirname(fileURLToPath(import.meta.url)), "hermes-connector");
}
