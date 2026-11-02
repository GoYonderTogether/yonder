import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { cwd, env, stderr, stdout } from "node:process";
import { offlineQuery, requestControl } from "@yonder/core";

export const usage = `Usage: yonder <command> [options]

Commands:
  init [dir] [--owner <id>] [--bundle core|default|full] [--model <provider/id>] [--isolated]  初始化数据目录 · Create a home
  channels list|login [instance] [--open] [--replace]  渠道列表 / 登录操作 · List / login (list login means supported, not online)
  login <provider> [--slot <name>] [--method oauth|api_key] [--replace]  登录模型账号
  credentials slots list|status|create|remove [provider] [slot] [--env-ref <variable>]  模型账号槽位
  credentials set <name> --home <dir>  本机隐藏录入命名密钥 · Store named secret (TTY only)
  doctor                          静态配置检查，非连通验收 · Static configuration check, not connectivity
  awake status|install|set off|tasks|always  任务期间保持唤醒 · macOS
  start [--no-gateway]            前台运行 · Start harness
  stop                            停止运行 · Stop harness
  ui [--open]                     打印/打开带一次性令牌的网页地址 · Print/open the web UI URL
  ui token --rotate               生成新的远程访问令牌 · Rotate the remote access token
  chat [--preset <id>|--session <id>|--channel <instance>] [--plain]  原生终端聊天 · Native TUI
  sessions list|show|open|submit|notify|abort|close  会话管理 · Manage sessions
  cron list|get|history|update|enable|disable|delete|run  定时任务管理 · Manage scheduled jobs
  events                          查询事件 · Query events
  identity lookup|link|unlink|person  身份管理 · Manage identities
  skills [show|add|remove] [--agent <id>] [--profile <name>]  技能管理 · Manage skills
  agents list|show|create|update|validate|archive|restore  Agent 管理（--file JSON；create --preset）
  presets list|show|create|update|validate|remove  预设管理（--file JSON）
  plugins list|show|add|remove      插件管理 · Manage plugins
  models list                     模型目录 · Model catalog
  inspect [--agent <id>] [--profile <name>]  有效配置 · Effective configuration
  migrate [--dry-run|--apply] [--no-service] | --rollback <backup> [--dry-run] [--force]  迁移旧数据目录与插件 id（默认只预览；非默认 home 自动跳过系统服务） · Migrate user data
  version                         版本与安装 · Version and installation
  changelog [--from <v>] [--to <v>]  更新记录 · Release notes
  docs [path] [--list]             文档 · Documentation
  update [--check | --to <tag>|latest|beta] [--repo <url>]  安装与更新 · Install or update
  uninstall [--purge] [--keep-home] [--json] [--dry-run]  卸载 · Uninstall
  service install|uninstall|start|stop|restart|status|info  服务管理 · Manage service
  completion zsh|bash|fish         shell 补全脚本 · Shell completion
`;

export const chatUsage =
	"Usage: yonder chat [--preset <id> | --session <id> | --channel <instance>] [--plain | --json]";
export const sessionsUsage =
	"Usage: yonder sessions list|show <id>|open <preset> [--keep-open]|submit <id> --text <text> [--attachment <path>]...|notify <id> --event <event> --text <text>|abort <id>|close <id>";
export const skillsUsage =
	"Usage: yonder skills [show <name>|add <directory>|remove <name>] [--agent <id>] [--profile <name>]";
export const releaseUsage: Record<string, string> = {
	channels: "Usage: yonder channels list|login [instance] [--poll] [--verify-code <code>] [--open] [--replace]",
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
export function namedOptions(args: string[], allowed: string[], usage: string): Record<string, string> {
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
export function optionalHome(options: Options): string | undefined {
	return options.home
		? resolve(options.home)
		: env.YONDER_HOME
			? resolve(env.YONDER_HOME)
			: existsYonder(cwd())
				? resolve(cwd())
				: undefined;
}
export function loginMessage(message: string): string {
	return message.replace(
		"an unfinished login in another pi session or by the Codex CLI",
		"another unfinished login process",
	);
}

export type Options = { json: boolean; help: boolean; home?: string; rest: string[] };
export function parseGlobal(args: string[]): Options {
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
export class UsageError extends Error {}
export function output(value: unknown, json: boolean) {
	stdout.write(json ? `${JSON.stringify(value)}\n` : `${typeof value === "string" ? value : humanOutput(value)}\n`);
}

export function humanOutput(value: unknown): string {
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

export async function print(value: Promise<unknown>, json: boolean) {
	output(await value, json);
	return 0;
}
export function fail(error: unknown, json: boolean, code = 1): number {
	const message = loginMessage(error instanceof Error ? error.message : String(error));
	stderr.write(`${message}\n`);
	if (json) output({ error: message }, true);
	return code;
}
/** 已配置渠道原样在前，随包提供但未启用的渠道（channels.list {shipped:true}）接在后面供显示。 */
export const channelsList = (home: string) =>
	Promise.all([{}, { shipped: true }].map((params) => requestControl(home, { method: "channels.list", params }))).then(
		(lists) => (lists as unknown[][]).flat(),
	);

export function homeFor(options: Options, init = false, target?: string): string {
	if (init && target) return resolve(target);
	if (options.home) return resolve(options.home);
	if (env.YONDER_HOME) return resolve(env.YONDER_HOME);
	if (init || existsYonder(cwd())) return resolve(cwd());
	throw new UsageError("home not found; pass --home, set YONDER_HOME, or run in a directory containing yonder.yaml");
}
export function existsYonder(dir: string) {
	return existsSync(join(dir, "yonder.yaml"));
}
export function connectionUnavailable(error: unknown) {
	const code = (error as NodeJS.ErrnoException)?.code;
	return code === "ECONNREFUSED" || code === "ENOENT";
}
export async function managed(home: string, request: { method: string; params?: unknown }, readOnly: boolean) {
	try {
		return await requestControl(home, request);
	} catch (error) {
		if (readOnly && connectionUnavailable(error)) return offlineQuery(home, request);
		throw error;
	}
}
