#!/usr/bin/env node
import { execFile } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { cwd, env, stderr, stdin, stdout } from "node:process";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { LoginInteraction } from "@yonder/core";
import {
	attachmentFromPath,
	checkRelease,
	cliChannelEndpoint,
	compareVersions,
	initHome,
	inspectHome,
	inspectSkills,
	installedService,
	loginProvider,
	manageCredentialSlots,
	manageService,
	offlineQuery,
	openKernel,
	readChangelog,
	readDocs,
	releaseInfo,
	requestControl,
	serveControl,
	setNamedCredential,
	updateRelease,
} from "@yonder/core";
import type { EventQuery, OutputPart, SessionInfo } from "@yonder/sdk";
import { installPower, setAwake, startAwake } from "./awake.js";
import { completion } from "./completion.js";
import { readHiddenCredential } from "./credential-input.js";
import { plainTaskChat } from "./plain-chat.js";
import type { ChatTarget } from "./terminal.js";

const usage = `Usage: yonder <command> [options]

Commands:
  init [dir] [--owner <id>] [--isolated]  初始化数据目录 · Create a home
  channels list|login [instance] [--open]  渠道扫码接入 · Connect channel
  login <provider> [--slot <name>] [--method oauth|api_key] [--replace]  登录模型账号
  credentials slots list|status|create|remove [provider] [slot] [--env-ref <variable>]  模型账号槽位
  credentials set <name> --home <dir>  本机隐藏录入命名密钥 · Store named secret (TTY only)
  doctor                          检查配置 · Check configuration
  awake status|install|set off|tasks|always  任务期间保持唤醒 · macOS
  start                           前台运行 · Start harness
  stop                            停止运行 · Stop harness
  chat [--preset <id>|--session <id>|--channel <instance>] [--plain]  原生终端聊天 · Native TUI
  sessions list|show|open|submit|notify|abort|close  会话管理 · Manage sessions
  events                          查询事件 · Query events
  identity lookup|link|unlink|person  身份管理 · Manage identities
  skills [show|add|remove] [--agent <id>] [--profile <name>]  技能管理 · Manage skills
  agents list|show|create|update|validate|archive|restore  Agent 管理（--file JSON；create --preset）
  presets list|show|create|update|validate|remove  预设管理（--file JSON）
  plugins list|show|add|remove      插件管理 · Manage plugins
  models list                     模型目录 · Model catalog
  inspect [--agent <id>] [--profile <name>]  有效配置 · Effective configuration
  version                         版本与安装 · Version and installation
  changelog [--from <v>] [--to <v>]  更新记录 · Release notes
  docs [path] [--list]             文档 · Documentation
  update [--check | --to <tag>|latest|beta] [--repo <url>]  安装与更新 · Install or update
  service install|uninstall|start|stop|restart|status|info  服务管理 · Manage service
  completion zsh|bash|fish         shell 补全脚本 · Shell completion
`;

const chatUsage = "Usage: yonder chat [--preset <id> | --session <id> | --channel <instance>] [--plain | --json]";
const sessionsUsage =
	"Usage: yonder sessions list|show <id>|open <preset> [--keep-open]|submit <id> --text <text> [--attachment <path>]...|notify <id> --event <event> --text <text>|abort <id>|close <id>";
const skillsUsage =
	"Usage: yonder skills [show <name>|add <directory>|remove <name>] [--agent <id>] [--profile <name>]";
const releaseUsage: Record<string, string> = {
	channels: "Usage: yonder channels list|login [instance] [--poll] [--verify-code <code>] [--open]",
	plugins: "Usage: yonder plugins list|show <id>|add <directory/package>|remove <id>",
	models: "Usage: yonder models list",
	inspect: "Usage: yonder inspect [--agent <id>] [--profile <name>]",
	version: "Usage: yonder version",
	changelog: "Usage: yonder changelog [--from <version>] [--to <version>]",
	docs: "Usage: yonder docs [path] [--list]",
	update: "Usage: yonder update --check | [--to <tag>|latest] [--repo <url>]",
	service:
		"Usage: yonder service install --home <dir> | uninstall | start | stop | restart | status | info --home <dir>",
};
function namedOptions(args: string[], allowed: string[], usage: string): Record<string, string> {
	const values: Record<string, string> = {};
	for (let index = 0; index < args.length; index++) {
		const key = args[index],
			value = args[++index];
		if (!key || !allowed.includes(key) || !value || value.startsWith("--") || values[key] !== undefined)
			throw new UsageError(usage);
		values[key] = value;
	}
	return values;
}
function optionalHome(options: Options): string | undefined {
	return options.home
		? resolve(options.home)
		: env.YONDER_HOME
			? resolve(env.YONDER_HOME)
			: existsYonder(cwd())
				? resolve(cwd())
				: undefined;
}
function loginMessage(message: string): string {
	return message.replace(
		"an unfinished login in another pi session or by the Codex CLI",
		"another unfinished login process",
	);
}

type Options = { json: boolean; help: boolean; home?: string; rest: string[] };
function parseGlobal(args: string[]): Options {
	let json = false;
	let help = false;
	let home: string | undefined;
	const rest: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === undefined) continue;
		if (arg === "--json") json = true;
		else if (arg === "--help") help = true;
		else if (arg === "--home") {
			home = args[++i];
			if (!home || home.startsWith("--")) throw new UsageError("--home requires a directory");
		} else if (arg.startsWith("--home=")) {
			home = arg.slice("--home=".length);
			if (!home) throw new UsageError("--home requires a directory");
		} else rest.push(arg);
	}
	return { json, help, ...(home ? { home } : {}), rest };
}
class UsageError extends Error {}
function output(value: unknown, json: boolean) {
	stdout.write(json ? `${JSON.stringify(value)}\n` : `${typeof value === "string" ? value : humanOutput(value)}\n`);
}

function humanOutput(value: unknown): string {
	if (value === undefined) return "完成 · Done";
	if (value === null) return "无结果 · No result";
	if (Array.isArray(value))
		return value.length ? value.map((item) => humanOutput(item)).join("\n\n") : "无记录 · No records";
	if (typeof value !== "object") return String(value);
	return Object.entries(value)
		.map(
			([key, item]) =>
				`${key}: ${item && typeof item === "object" ? JSON.stringify(item, null, 2) : String(item ?? "—")}`,
		)
		.join("\n");
}

async function print(value: Promise<unknown>, json: boolean) {
	output(await value, json);
	return 0;
}
function fail(error: unknown, json: boolean, code = 1): number {
	const message = loginMessage(error instanceof Error ? error.message : String(error));
	stderr.write(`${message}\n`);
	if (json) output({ error: message }, true);
	return code;
}
function homeFor(options: Options, init = false, target?: string): string {
	if (init && target) return resolve(target);
	if (options.home) return resolve(options.home);
	if (env.YONDER_HOME) return resolve(env.YONDER_HOME);
	if (init || existsYonder(cwd())) return resolve(cwd());
	throw new UsageError("home not found; pass --home, set YONDER_HOME, or run in a directory containing yonder.yaml");
}
function existsYonder(dir: string) {
	return existsSync(join(dir, "yonder.yaml"));
}
function requiredParam(params: Record<string, unknown>, name: string): string {
	const value = params[name];
	if (typeof value !== "string") throw new Error(`control request requires ${name}`);
	return value;
}
function personParam(value: unknown): { id: string; name: string; note?: string } {
	if (!value || typeof value !== "object" || !("id" in value) || !("name" in value))
		throw new Error("control request requires person id and name");
	const person = value as { id: unknown; name: unknown; note?: unknown };
	if (typeof person.id !== "string" || typeof person.name !== "string")
		throw new Error("control request requires person id and name");
	return { id: person.id, name: person.name, ...(typeof person.note === "string" ? { note: person.note } : {}) };
}
function connectionUnavailable(error: unknown) {
	const code = (error as NodeJS.ErrnoException)?.code;
	return code === "ECONNREFUSED" || code === "ENOENT";
}
async function managed(home: string, request: { method: string; params?: unknown }, readOnly: boolean) {
	try {
		return await requestControl(home, request);
	} catch (error) {
		if (readOnly && connectionUnavailable(error)) return offlineQuery(home, request);
		throw error;
	}
}
async function chat(home: string, instance: string, json: boolean) {
	const socket = createConnection(cliChannelEndpoint(home, instance));
	socket.setEncoding("utf8");
	const lines = createInterface({ input: socket, crlfDelay: Infinity });
	const terminal = createInterface({ input: stdin, output: json ? stderr : stdout, terminal: stdin.isTTY });
	let streamed = "";
	const fromOutput = (part: OutputPart | { type: "message"; text: string } | { type: "error"; message: string }) => {
		if (part.type === "text") {
			streamed += part.delta;
			if (json) output(part, true);
			else stdout.write(part.delta);
		} else if (part.type === "final") {
			if (json) output(part, true);
			else {
				if (streamed) stdout.write("\n");
				if (part.text && part.text !== streamed) stdout.write(`${part.text}\n`);
			}
			streamed = "";
		} else if (part.type === "message") output(part.text, json);
		else if (part.type === "tool") {
			if (json) output(part, true);
			else if (part.phase === "start") stderr.write(`[${part.name}] ${part.label ?? ""}\n`);
		} else if (part.type === "error") {
			if (json) output(part, true);
			else stderr.write(`${part.message}\n`);
		}
	};
	lines.on("line", (line) => {
		try {
			fromOutput(JSON.parse(line) as Parameters<typeof fromOutput>[0]);
		} catch (error) {
			stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		}
	});
	try {
		await new Promise<void>((resolve, reject) => {
			socket.once("connect", resolve);
			socket.once("error", reject);
			lines.once("error", reject);
		});
		socket.once("close", () => terminal.close());
		for await (const line of terminal) {
			if (socket.destroyed) break;
			socket.write(`${line}\n`);
		}
		if (!socket.destroyed) {
			const closed = new Promise<void>((resolve) => socket.once("close", resolve));
			socket.end();
			await closed;
		}
	} finally {
		terminal.close();
		socket.destroy();
	}
}

async function run(args: string[]): Promise<number> {
	if (args[0] === "--help" || args[0] === "help") {
		output(usage, args.includes("--json"));
		return 0;
	}
	const options = parseGlobal(args);
	if (!optionalHome(options))
		options.home =
			(await installedService())?.home ??
			(process.platform === "win32"
				? join(env.LOCALAPPDATA ?? join(homedir(), "AppData/Local"), "YonderHarness/home")
				: join(homedir(), ".local/share/yonder-harness/home"));
	const daily = !options.rest.length && !options.help && stdin.isTTY && stdout.isTTY && !options.json;
	if (daily) options.rest.push("chat");
	const [command, ...rest] = options.rest;
	if (options.help) {
		output(
			command === "skills"
				? skillsUsage
				: command === "chat"
					? chatUsage
					: command === "sessions"
						? sessionsUsage
						: (releaseUsage[command ?? ""] ?? usage),
			options.json,
		);
		return 0;
	}
	if (!command) throw new UsageError(usage);
	if (command === "completion") {
		if (rest.length !== 1 || !rest[0] || !["zsh", "bash", "fish"].includes(rest[0]))
			throw new UsageError("Usage: yonder completion zsh|bash|fish");
		const script = completion(rest[0]);
		if (!options.json) {
			stdout.write(script);
			return 0;
		}
		const candidates: { sessions: string[]; presets: string[]; channels: string[] } = {
			sessions: [],
			presets: [],
			channels: [],
		};
		const home = optionalHome(options);
		if (home) {
			try {
				const [sessions, presets, channels] = await Promise.all([
					requestControl(home, { method: "sessions.list", params: { filter: { open: true } } }) as Promise<
						SessionInfo[]
					>,
					requestControl(home, { method: "terminal.presets" }) as Promise<Array<{ id: string }>>,
					requestControl(home, { method: "terminal.channels" }) as Promise<Array<{ id: string }>>,
				]);
				candidates.sessions = sessions.map((item) => item.id);
				candidates.presets = presets.map((item) => item.id);
				candidates.channels = channels.map((item) => item.id);
			} catch (error) {
				if (!connectionUnavailable(error)) throw error;
			}
		}
		output({ script, candidates }, true);
		return 0;
	}
	if (command === "version") {
		if (rest.length) throw new UsageError(releaseUsage.version);
		return print(releaseInfo(optionalHome(options)), options.json);
	}
	if (command === "changelog") {
		const flags = namedOptions(rest, ["--from", "--to"], releaseUsage.changelog ?? "");
		for (const value of Object.values(flags))
			try {
				compareVersions(value, "0.0.0");
			} catch {
				throw new UsageError("Versions must use X.Y.Z[-beta.N] or vX.Y.Z[-beta.N]");
			}
		return print(readChangelog(flags["--from"], flags["--to"]), options.json);
	}
	if (command === "docs") {
		const list = rest.includes("--list"),
			paths = rest.filter((value) => value !== "--list");
		if (
			paths.length > 1 ||
			paths.some((value) => value.startsWith("-")) ||
			rest.filter((value) => value === "--list").length > 1
		)
			throw new UsageError(releaseUsage.docs);
		return print(readDocs(paths[0], list), options.json);
	}
	if (command === "update") {
		if (rest.length === 1 && rest[0] === "--check") return print(checkRelease(), options.json);
		const args = rest[0] === "latest" ? rest.slice(1) : rest;
		const flags = namedOptions(args, ["--to", "--repo"], releaseUsage.update ?? "");
		if (rest[0] === "latest" && flags["--to"]) throw new UsageError(releaseUsage.update);
		const to = rest[0] === "latest" ? "latest" : flags["--to"];
		if (to && to !== "latest" && to !== "beta")
			try {
				compareVersions(to, "0.0.0");
			} catch {
				throw new UsageError("Release tags must use vX.Y.Z or vX.Y.Z-beta.N");
			}
		const home = optionalHome(options),
			repo = flags["--repo"];
		return print(
			updateRelease({
				...(to ? { to } : {}),
				...(repo ? { repo } : {}),
				...(home ? { home } : {}),
				onProgress: (stage) => stderr.write(`${stage}\n`),
			}),
			options.json,
		);
	}
	if (command === "channels") {
		const [action, ...values] = rest;
		if (action === "list" && !values.length)
			return print(requestControl(homeFor(options), { method: "channels.list" }), options.json);
		if (action !== "login")
			throw new UsageError("Usage: yonder channels list|login [instance] [--poll] [--verify-code <code>] [--open]");
		let instance: string | undefined,
			verifyCode: string | undefined,
			open = false,
			poll = false;
		for (let index = 0; index < values.length; index++) {
			const value = values[index]!;
			if (value === "--open") open = true;
			else if (value === "--poll") poll = true;
			else if (value === "--verify-code") {
				verifyCode = values[++index];
				if (!verifyCode || !/^\d{1,12}$/.test(verifyCode)) throw new UsageError("Invalid verification code");
				poll = true;
			} else if (!value.startsWith("-") && !instance) instance = value;
			else throw new UsageError("Invalid channels login option");
		}
		const result = (await requestControl(homeFor(options), {
			method: "channels.login",
			params: {
				...(instance ? { instance } : {}),
				action: poll ? "poll" : "start",
				...(verifyCode ? { verifyCode } : {}),
			},
		})) as { qrcodeUrl?: string };
		output(result, options.json);
		if (open && result.qrcodeUrl) {
			const url = new URL(result.qrcodeUrl);
			if (url.protocol !== "https:" || url.username || url.password)
				throw new Error("Channel login only opens HTTPS links");
			await promisify(execFile)(process.platform === "darwin" ? "open" : "xdg-open", [url.href]);
		}
		return 0;
	}
	if (command === "service") {
		const action = rest[0];
		if (action === "info" && rest.length === 1)
			return print(requestControl(homeFor(options), { method: "service.info" }), options.json);
		if (
			rest.length !== 1 ||
			!action ||
			!["install", "uninstall", "start", "stop", "restart", "status"].includes(action)
		)
			throw new UsageError(releaseUsage.service);
		return print(
			manageService(
				action as Parameters<typeof manageService>[0],
				action === "install" ? { home: homeFor(options) } : {},
			),
			options.json,
		);
	}

	if (command === "init") {
		const ownerIndex = rest.indexOf("--owner");
		const isolated = rest.includes("--isolated");
		const owner = ownerIndex >= 0 ? rest[ownerIndex + 1] : "owner";
		const target = rest.find(
			(value, index) => !value.startsWith("-") && !(ownerIndex >= 0 && index === ownerIndex + 1),
		);
		if (ownerIndex >= 0 && (!owner || owner.startsWith("-"))) throw new UsageError("init --owner requires an id");
		if (
			rest.some((value) => value.startsWith("-") && value !== "--owner" && value !== "--isolated") ||
			rest.filter((value, index) => !value.startsWith("-") && !(ownerIndex >= 0 && index === ownerIndex + 1)).length > 1
		)
			throw new UsageError("Usage: yonder init [dir] [--owner <id>] [--isolated]");
		const home = homeFor(options, true, target);
		return print(initHome(home, owner, { isolated }), options.json);
	}
	if (command === "credentials" && rest[0] === "slots") {
		const action = rest[1];
		const provider = rest[2],
			slot = rest[3];
		const variable = rest[4] === "--env-ref" ? rest[5] : undefined;
		if (
			!action ||
			!["list", "status", "create", "remove"].includes(action) ||
			(action === "list"
				? rest.length !== 2
				: !provider || !slot || !(rest.length === 4 || (action === "create" && rest.length === 6 && variable)))
		)
			throw new UsageError(
				"Usage: yonder credentials slots list|status|create|remove [provider] [slot] [--env-ref <variable>]",
			);
		return print(
			manageCredentialSlots(
				homeFor(options),
				action as "list" | "status" | "create" | "remove",
				provider,
				slot,
				variable,
			),
			options.json,
		);
	}
	if (command === "credentials") {
		if (
			rest.length !== 2 ||
			rest[0] !== "set" ||
			!rest[1] ||
			!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(rest[1]) ||
			!options.home ||
			options.json
		)
			throw new UsageError("Usage: yonder credentials set <name> --home <dir> (local TTY only; no secret arguments)");
		const home = homeFor(options);
		stderr.write(`Home: ${home}\nNew credential: ${rest[1]} (existing names are never replaced)\n`);
		let secret = await readHiddenCredential();
		try {
			await setNamedCredential(home, rest[1], secret);
		} catch {
			throw new Error(
				"Credential not saved: invalid input, existing name, unsafe storage, or storage failure; inspect local permissions without printing credentials",
			);
		} finally {
			secret = "";
		}
		output({ name: rest[1], saved: true }, false);
		return 0;
	}
	if (command === "login") {
		const provider = rest[0];
		const loginOptions: { slot?: string; replace?: boolean; method?: "oauth" | "api_key" } = {};
		if (!provider || provider.startsWith("-"))
			throw new UsageError("Usage: yonder login <provider> [--slot <name>] [--method oauth|api_key] [--replace]");
		for (let i = 1; i < rest.length; i++) {
			const arg = rest[i];
			if (arg === "--replace" && !loginOptions.replace) loginOptions.replace = true;
			else if (arg === "--slot" && !loginOptions.slot && rest[i + 1] && !rest[i + 1]!.startsWith("-"))
				loginOptions.slot = rest[++i] as string;
			else if (arg === "--method" && !loginOptions.method && ["oauth", "api_key"].includes(rest[i + 1] ?? ""))
				loginOptions.method = rest[++i] as "oauth" | "api_key";
			else throw new UsageError("Usage: yonder login <provider> [--slot <name>] [--method oauth|api_key] [--replace]");
		}
		if (!stdin.isTTY || !stderr.isTTY || options.json)
			throw new Error(
				"Provider login requires a local interactive TTY; authorization details are never emitted as JSON",
			);
		const home = homeFor(options);
		stderr.write(
			`Home: ${home}\nProvider: ${provider}; slot: ${loginOptions.slot ?? "default"}; ${loginOptions.replace ? "explicit replace" : "create only"}\n`,
		);
		const controller = new AbortController();
		const cancel = () => controller.abort();
		process.once("SIGINT", cancel);
		const interaction: LoginInteraction = {
			signal: controller.signal,
			async prompt(prompt) {
				stderr.write(`${prompt.message}\n`);
				const signal = prompt.signal ? AbortSignal.any([controller.signal, prompt.signal]) : controller.signal;
				signal.throwIfAborted();
				if (prompt.type === "secret" || prompt.type === "manual_code") return readHiddenCredential(signal);
				if (prompt.type === "select")
					for (const option of prompt.options) stderr.write(`${option.id}: ${option.label}\n`);
				const terminal = createInterface({ input: stdin, output: stderr });
				try {
					return await new Promise<string>((resolve, reject) => {
						const abort = () => {
							terminal.close();
							reject(new Error("Login cancelled"));
						};
						signal.addEventListener("abort", abort, { once: true });
						terminal.question("> ", (answer) => {
							signal.removeEventListener("abort", abort);
							if (prompt.type === "select" && !prompt.options.some((option) => option.id === answer))
								reject(new Error("Invalid authentication selection"));
							else resolve(answer);
						});
					});
				} finally {
					terminal.close();
				}
			},
			notify(event) {
				if (event.type === "auth_url") {
					stderr.write(`Yonder Harness sign-in: ${event.url}\n`);
					if (event.instructions) stderr.write(`${loginMessage(event.instructions)}\n`);
				} else if (event.type === "device_code")
					stderr.write(`Yonder Harness sign-in: ${event.verificationUri}\nCode: ${event.userCode}\n`);
				else {
					stderr.write(`${loginMessage(event.message)}\n`);
					if (event.type === "info")
						for (const link of event.links ?? []) stderr.write(`${link.label ? `${link.label}: ` : ""}${link.url}\n`);
				}
			},
		};
		try {
			await loginProvider(home, provider, interaction, loginOptions);
		} catch {
			throw new Error(
				"Login failed or cancelled; inspect slot status before retrying (existing or changed account, unsupported authentication, or provider/storage failure)",
			);
		} finally {
			process.removeListener("SIGINT", cancel);
		}
		output({ ok: true, provider, slot: loginOptions.slot ?? "default" }, options.json);
		return 0;
	}
	if (command === "doctor") {
		if (rest.length) throw new UsageError("Usage: yonder doctor");
		const result = await inspectHome(homeFor(options));
		if (options.json) output(result, true);
		else {
			output(result.ok ? "Doctor: passed" : "Doctor: issues found", false);
			for (const issue of result.errors) stdout.write(`ERROR: ${issue}\n`);
			for (const warning of result.warnings) stdout.write(`WARNING: ${warning}\n`);
		}
		return result.ok ? 0 : 1;
	}
	if (command === "agents" || command === "presets") {
		const operation = rest[0];
		const usage = `Usage: yonder ${command} list|show <id>|create <id> --file <json> [--preset <id>]|update <id> --file <json>|validate <id> --file <json>|${command === "agents" ? "archive|remove|restore" : "remove"} <id>`;
		if (
			!operation ||
			!["list", "show", "create", "update", "validate", "archive", "remove", "restore"].includes(operation)
		)
			throw new UsageError(usage);
		if (operation === "list" && rest.length !== 1) throw new UsageError(usage);
		const id = operation === "list" ? undefined : rest[1];
		if (operation !== "list" && (!id || id.startsWith("--"))) throw new UsageError(usage);
		const flags = namedOptions(rest.slice(operation === "list" ? 1 : 2), ["--file", "--preset"], usage);
		if (["create", "update", "validate"].includes(operation) && !flags["--file"]) throw new UsageError(usage);
		const value = flags["--file"] ? JSON.parse(await readFile(resolve(flags["--file"]), "utf8")) : undefined;
		return print(
			managed(
				homeFor(options),
				{ method: "management", params: { action: `${command}.${operation}`, id, preset: flags["--preset"], value } },
				true,
			),
			options.json,
		);
	}
	if (["plugins", "models", "inspect"].includes(command)) {
		let action: string, id: string | undefined, source: string | undefined;
		let flags: Record<string, string> = {};
		if (command === "inspect") {
			action = "inspect";
			flags = namedOptions(rest, ["--agent", "--profile"], "Usage: yonder inspect [--agent <id>] [--profile <name>]");
		} else if (command === "models") {
			if (rest.length !== 1 || rest[0] !== "list") throw new UsageError("Usage: yonder models list");
			action = "models.list";
		} else {
			const operation = rest[0];
			if (
				!operation ||
				!["list", "show", "add", "remove"].includes(operation) ||
				rest.length !== (operation === "list" ? 1 : 2)
			)
				throw new UsageError("Usage: yonder plugins list|show <id>|add <directory/package>|remove <id>");
			action = `plugins.${operation}`;
			if (operation === "add") source = rest[1]!.startsWith(".") || existsSync(rest[1]!) ? resolve(rest[1]!) : rest[1];
			else id = rest[1];
		}
		return print(
			managed(
				homeFor(options),
				{
					method: "management",
					params: {
						action,
						...(id ? { id } : {}),
						...(source ? { source } : {}),
						...(flags["--agent"] ? { agent: flags["--agent"] } : {}),
						...(flags["--profile"] ? { profile: flags["--profile"] } : {}),
					},
				},
				true,
			),
			options.json,
		);
	}
	if (command === "skills") {
		const operation = rest[0] && ["show", "add", "remove"].includes(rest[0]) ? rest[0] : undefined;
		const target = operation ? rest[1] : undefined;
		if (operation && (!target || target.startsWith("--"))) throw new UsageError(skillsUsage);
		const flags = namedOptions(
			operation ? rest.slice(2) : rest,
			operation && operation !== "show" ? ["--agent"] : ["--agent", "--profile"],
			skillsUsage,
		);
		if (!operation)
			return print(inspectSkills(homeFor(options), flags["--agent"] ?? "main", flags["--profile"]), options.json);
		return print(
			managed(
				homeFor(options),
				{
					method: "management",
					params: {
						action: `skills.${operation}`,
						...(operation === "add" ? { source: resolve(target!) } : { id: target }),
						...(flags["--agent"] ? { agent: flags["--agent"] } : {}),
						...(flags["--profile"] ? { profile: flags["--profile"] } : {}),
					},
				},
				true,
			),
			options.json,
		);
	}

	if (command === "awake") {
		const [action, value] = rest;
		if (action === "install" && rest.length === 1) return print(installPower(), options.json);
		if (action === "status" && rest.length === 1)
			return print(requestControl(homeFor(options), { method: "awake.status" }), options.json);
		if (
			action === "set" &&
			rest.length === 2 &&
			(value === "on" || value === "off" || value === "tasks" || value === "always")
		)
			return print(setAwake(homeFor(options), value === "on" ? "tasks" : value), options.json);
		throw new UsageError("Usage: yonder awake status|install|set off|tasks|always");
	}

	if (command === "start") {
		if (rest.length) throw new UsageError("Usage: yonder start");
		const home = homeFor(options);
		env.YONDER_HOME = home;
		const plugins = (await offlineQuery(home, { method: "management", params: { action: "plugins.list" } })) as Array<{
			id: string;
		}>;
		if (!plugins.some((plugin) => plugin.id === "ui-companion"))
			await offlineQuery(home, {
				method: "management",
				params: { action: "plugins.add", source: "@yonder/plugin-ui-companion" },
			});
		const kernel = await openKernel(home, {
			log: (level, message, data) =>
				output({ ts: new Date().toISOString(), level, message, ...(data ? { data } : {}) }, options.json),
		});
		const awake = startAwake(home, () => kernel.awakeActivity());
		let closing: Promise<void> | undefined;
		let control: Awaited<ReturnType<typeof serveControl>>;
		let finish!: () => void;
		const stopped = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const stop = () => {
			if (closing) return closing;
			closing = (async () => {
				awake.close();
				await control?.close();
				await kernel.close();
				finish();
			})();
			return closing;
		};
		try {
			control = await serveControl(home, async (request, connection) => {
				const params = (request.params ?? {}) as Record<string, unknown>;
				switch (request.method) {
					case "awake.status":
						return awake.status();
					case "channels.list":
						return kernel.channels.list();
					case "channels.login":
						return kernel.channels.login(params as Parameters<typeof kernel.channels.login>[0], connection.signal);
					case "release.result":
						return kernel.releaseResult(params.data as Parameters<typeof kernel.releaseResult>[0]);
					case "sessions.notify":
						return kernel.notify(requiredParam(params, "id"), {
							event: requiredParam(params, "event"),
							text: requiredParam(params, "text"),
						});
					case "management":
						return kernel.management(params as unknown as Parameters<typeof kernel.management>[0]);
					case "terminal.sessions":
						return kernel.terminal.list();
					case "terminal.presets":
						return kernel.terminal.presets();
					case "terminal.channels":
						return kernel.terminal.channels();
					case "terminal.queued":
						return kernel.terminal.queued(requiredParam(params, "id"));
					case "terminal.dequeue":
						return kernel.terminal.queued(requiredParam(params, "id"), true);
					case "service.info": {
						const info = await releaseInfo(home);
						return {
							version: info.version,
							commit: info.origin?.commit ?? null,
							home,
							pid: process.pid,
							ready: true,
							active: (await kernel.awakeActivity()).active,
							agents: await kernel.terminal.activity(),
						};
					}
					case "terminal.info":
						return kernel.terminal.info(requiredParam(params, "id"));
					case "sessions.command":
						return kernel.sessions.command(requiredParam(params, "id"), requiredParam(params, "command"));
					case "sessions.open": {
						const policy = params.close;
						if (policy !== undefined && policy !== "manual" && policy !== "run-end")
							throw new Error("Invalid close policy");
						return kernel.sessions.open({
							preset: requiredParam(params, "preset"),
							...(policy ? { close: policy } : {}),
						});
					}
					case "sessions.submit": {
						const busy = params.busy;
						if (busy !== undefined && busy !== "followup" && busy !== "steer" && busy !== "interrupt")
							throw new Error("Invalid busy mode");
						return kernel.terminal.submit(
							requiredParam(params, "id"),
							{
								text: requiredParam(params, "text"),
								...(Array.isArray(params.attachments)
									? { attachments: params.attachments as import("@yonder/sdk").Attachment[] }
									: {}),
							},
							busy,
						);
					}
					case "sessions.watch": {
						const id = requiredParam(params, "id");
						const info = await kernel.terminal.info(id);
						const dispose = await kernel.terminal.observe(id, async (update) =>
							connection.send({ type: "update", session: id, update }),
						);
						if (connection.signal.aborted) await dispose();
						else
							connection.signal.addEventListener(
								"abort",
								() => {
									void dispose();
								},
								{ once: true },
							);
						return info;
					}
					case "sessions.list":
						return kernel.sessions.list((params.filter ?? {}) as Parameters<typeof kernel.sessions.list>[0]);
					case "sessions.show": {
						const id = requiredParam(params, "id");
						const session = await kernel.sessions.get(id);
						if (!session) throw new Error(`Unknown session: ${id}`);
						return { session, transcript: await kernel.sessions.transcript(id) };
					}
					case "sessions.abort":
						return kernel.sessions.abort(requiredParam(params, "id")).then(() => ({ ok: true }));
					case "sessions.close":
						return kernel.sessions.close(requiredParam(params, "id")).then(() => ({ ok: true }));
					case "events.query":
						return kernel.events.query((params.query ?? {}) as EventQuery);
					case "identity.lookup":
						return kernel.identity.lookup(requiredParam(params, "ref"));
					case "identity.link":
						return kernel.identity
							.link(requiredParam(params, "account"), requiredParam(params, "person"))
							.then(() => ({ ok: true }));
					case "identity.unlink":
						return kernel.identity.unlink(requiredParam(params, "account")).then(() => ({ ok: true }));
					case "identity.person":
						return kernel.identity.createPerson(personParam(params.person));
					case "stop":
						setImmediate(() => void stop());
						return { stopping: true };
					default:
						throw new Error(`unknown control method: ${request.method}`);
				}
			});
		} catch (error) {
			awake.close();
			await kernel.close();
			throw error;
		}
		const signal = () => void stop();
		process.once("SIGINT", signal);
		process.once("SIGTERM", signal);
		await stopped;
		process.off("SIGINT", signal);
		process.off("SIGTERM", signal);
		return 0;
	}
	if (command === "stop") {
		if (rest.length) throw new UsageError("Usage: yonder stop");
		await requestControl(homeFor(options), { method: "stop" });
		output({ stopping: true }, options.json);
		return 0;
	}
	if (command === "chat") {
		const target: ChatTarget = {};
		let plain = false;
		for (let index = 0; index < rest.length; index++) {
			const flag = rest[index];
			if (flag === "--plain" && !plain) {
				plain = true;
				continue;
			}
			if (!flag || !["--channel", "--session", "--preset"].includes(flag)) throw new UsageError(chatUsage);
			const value = rest[++index];
			if (!value || value.startsWith("--") || Object.keys(target).length) throw new UsageError(chatUsage);
			if (flag === "--channel") target.channel = value;
			else if (flag === "--session") target.session = value;
			else target.preset = value;
		}
		if (plain && options.json) throw new UsageError(chatUsage);
		const home = homeFor(options);
		if (daily) {
			if (!existsYonder(home))
				throw new UsageError(
					"首次使用请运行 yonder init、yonder login openai、yonder service install，然后运行 yonder。",
				);
			const channels = (await requestControl(home, { method: "terminal.channels" })) as Array<{ id: string }>;
			const channel = channels.find((channel) => channel.id === "cli") ?? channels[0];
			if (channel) target.channel = channel.id;
		}
		if (plain || options.json || !stdin.isTTY || !stdout.isTTY) {
			if (target.channel) await chat(home, target.channel, options.json);
			else await plainTaskChat(home, target, options.json);
		} else {
			const { runTerminal } = await import("./terminal.js");
			try {
				await runTerminal(home, target);
			} catch (error) {
				if (connectionUnavailable(error))
					throw new Error(
						"服务未运行 / Service unavailable: run yonder start --home <home>, or yonder service start for an installed service",
					);
				throw error;
			}
		}
		return 0;
	}
	if (command === "sessions") {
		const [subcommand, ...args2] = rest;
		if (subcommand === "open") {
			const keep = args2.includes("--keep-open"),
				names = args2.filter((arg) => arg !== "--keep-open");
			if (names.length !== 1 || !names[0] || names[0].startsWith("-") || args2.length !== (keep ? 2 : 1))
				throw new UsageError(sessionsUsage);
			return print(
				requestControl(homeFor(options), {
					method: "sessions.open",
					params: { preset: names[0], ...(keep ? { close: "manual" } : {}) },
				}),
				options.json,
			);
		}
		if (subcommand === "notify") {
			const id = args2[0];
			if (!id) throw new UsageError(sessionsUsage);
			const flags = namedOptions(args2.slice(1), ["--event", "--text"], sessionsUsage);
			if (!flags["--event"] || !flags["--text"]) throw new UsageError(sessionsUsage);
			return print(
				requestControl(homeFor(options), {
					method: "sessions.notify",
					params: { id, event: flags["--event"], text: flags["--text"] },
				}),
				options.json,
			);
		}
		if (subcommand === "submit") {
			const id = args2[0];
			if (!id) throw new UsageError(sessionsUsage);
			let text: string | undefined;
			const attachments: import("@yonder/sdk").Attachment[] = [];
			for (let index = 1; index < args2.length; index += 2) {
				const flag = args2[index],
					value = args2[index + 1];
				if (value === undefined) throw new UsageError(sessionsUsage);
				if (flag === "--text" && text === undefined) text = value;
				else if (flag === "--attachment") attachments.push(await attachmentFromPath(value));
				else throw new UsageError(sessionsUsage);
			}
			if (text === undefined && !attachments.length) throw new UsageError(sessionsUsage);
			return print(
				managed(
					homeFor(options),
					{
						method: "sessions.submit",
						params: { id, text: text ?? "", ...(attachments.length ? { attachments } : {}) },
					},
					false,
				),
				options.json,
			);
		}

		if (subcommand === "list") {
			const filter: { agent?: string; mode?: SessionInfo["mode"]; open?: boolean } = {};
			for (let i = 0; i < args2.length; i++) {
				const key = args2[i];
				if (key === "--agent") {
					const value = args2[++i];
					if (!value) throw new UsageError("--agent requires an id");
					filter.agent = value;
				} else if (key === "--mode") {
					const value = args2[++i];
					if (!value || !["main", "persistent", "ephemeral", "task"].includes(value))
						throw new UsageError("--mode requires main, persistent, ephemeral, or task");
					filter.mode = value as SessionInfo["mode"];
				} else if (key === "--open") filter.open = true;
				else throw new UsageError("Usage: yonder sessions list [--agent <id>] [--mode <mode>] [--open]");
			}
			return print(managed(homeFor(options), { method: "sessions.list", params: { filter } }, true), options.json);
		}
		if (subcommand === "show" && args2.length === 1)
			return print(
				managed(homeFor(options), { method: "sessions.show", params: { id: args2[0] } }, true),
				options.json,
			);
		if ((subcommand === "abort" || subcommand === "close") && args2.length === 1)
			return print(
				managed(homeFor(options), { method: `sessions.${subcommand}`, params: { id: args2[0] } }, false),
				options.json,
			);
		throw new UsageError(sessionsUsage);
	}
	if (command === "events") {
		const query: EventQuery = {};
		const fields: Record<string, keyof EventQuery> = {
			"--type": "type",
			"--from": "from",
			"--conv": "conv",
			"--agent": "agent",
			"--since": "since",
			"--until": "until",
			"--after": "after",
			"--limit": "limit",
		};
		for (let i = 0; i < rest.length; i++) {
			const key = rest[i];
			const field = fields[key ?? ""];
			if (!field || rest[i + 1] === undefined)
				throw new UsageError("Usage: yonder events [--type --from --conv --agent --since --until --after --limit]");
			const value = rest[i + 1];
			if (value === undefined) throw new UsageError("event filter requires a value");
			i++;
			if (field === "limit") {
				const limit = Number(value);
				if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
					throw new UsageError("--limit must be an integer from 1 to 1000");
				(query as Record<string, unknown>)[field] = limit;
			} else (query as Record<string, unknown>)[field] = value;
		}
		return print(managed(homeFor(options), { method: "events.query", params: { query } }, true), options.json);
	}
	if (command === "identity") {
		const [subcommand, ...values] = rest;
		if (subcommand === "lookup" && values.length === 1)
			return print(
				managed(homeFor(options), { method: "identity.lookup", params: { ref: values[0] } }, true),
				options.json,
			);
		if (subcommand === "link" && values.length === 2)
			return print(
				managed(
					homeFor(options),
					{ method: "identity.link", params: { account: values[0], person: values[1] } },
					false,
				),
				options.json,
			);
		if (subcommand === "unlink" && values.length === 1)
			return print(
				managed(homeFor(options), { method: "identity.unlink", params: { account: values[0] } }, false),
				options.json,
			);
		if (subcommand === "person" && values.length === 2)
			return print(
				managed(
					homeFor(options),
					{ method: "identity.person", params: { person: { id: values[0], name: values[1] } } },
					false,
				),
				options.json,
			);
		throw new UsageError("Usage: yonder identity lookup <ref>|link <acct> <person>|unlink <acct>|person <id> <name>");
	}
	throw new UsageError(`Unknown command: ${command}; run yonder help`);
}

export async function main(args = process.argv.slice(2)) {
	try {
		return await run(args);
	} catch (error) {
		return fail(error, args.includes("--json"), error instanceof UsageError ? 2 : 1);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
	process.exitCode = await main();
}
