import { stdin, stdout } from "node:process";
import { attachmentFromPath, requestControl } from "@yonder/core";
import type { Attachment, EventQuery, SessionInfo } from "@yonder/sdk";
import { plainTaskChat } from "../plain-chat.js";
import type { ChatTarget } from "../terminal.js";
import {
	chatUsage,
	connectionUnavailable,
	existsYonder,
	homeFor,
	managed,
	namedOptions,
	type Options,
	print,
	sessionsUsage,
	UsageError,
} from "./context.js";
import { chat } from "./runtime.js";

/** `chat`, `sessions`, `events` and `identity`. */
export async function runChat(
	command: string,
	options: Options,
	rest: string[],
	daily: boolean,
): Promise<number | undefined> {
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
			const { runTerminal } = await import("../terminal.js");
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
	if (command === "sessions") return runSessions(options, rest);
	if (command === "events") return runEvents(options, rest);
	if (command !== "identity") return undefined;
	const [subcommand, ...values] = rest;
	if (subcommand === "lookup" && values.length === 1)
		return print(
			managed(homeFor(options), { method: "identity.lookup", params: { ref: values[0] } }, true),
			options.json,
		);
	if (subcommand === "link" && values.length === 2)
		return print(
			managed(homeFor(options), { method: "identity.link", params: { account: values[0], person: values[1] } }, false),
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

async function runSessions(options: Options, rest: string[]): Promise<number> {
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
		const attachments: Attachment[] = [];
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
		return print(managed(homeFor(options), { method: "sessions.show", params: { id: args2[0] } }, true), options.json);
	if ((subcommand === "abort" || subcommand === "close") && args2.length === 1)
		return print(
			managed(homeFor(options), { method: `sessions.${subcommand}`, params: { id: args2[0] } }, false),
			options.json,
		);
	throw new UsageError(sessionsUsage);
}

function runEvents(options: Options, rest: string[]): Promise<number> {
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
