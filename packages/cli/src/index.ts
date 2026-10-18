#!/usr/bin/env node
import { existsSync } from "node:fs";
import { createConnection } from "node:net";
import { join, resolve } from "node:path";
import { cwd, env, stderr, stdin, stdout } from "node:process";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { inspect } from "node:util";
import type { LoginInteraction } from "@yonder/core";
import {
	initHome,
	inspectHome,
	inspectSkills,
	loginProvider,
	offlineQuery,
	openKernel,
	requestControl,
	serveControl,
} from "@yonder/core";
import type { EventQuery, OutputPart, SessionInfo } from "@yonder/sdk";

const usage = `Usage: yonder <command> [options]

Commands:
  init [dir] [--owner <id>]       Create a home
  login <provider>                Authenticate a model provider
  doctor                          Check the home configuration
  start                           Run the harness in the foreground
  stop                            Stop a running harness
  chat [--channel <instance>]      Chat through channel-cli
  sessions list|show|abort|close  Inspect and manage sessions
  events                          Query events
  identity lookup|link|unlink|person  Manage identities
  skills [--agent <id>] [--profile <name>]  List skills
  version                         Show version (T14)
  changelog|docs|update           Release commands (T14)
  service                         Service commands (T14)
`;

const skillsUsage = "Usage: yonder skills [--agent <id>] [--profile <name>]";
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
			if (!home) throw new UsageError("--home requires a directory");
		} else if (arg.startsWith("--home=")) {
			home = arg.slice("--home=".length);
			if (!home) throw new UsageError("--home requires a directory");
		} else rest.push(arg);
	}
	return { json, help, ...(home ? { home } : {}), rest };
}
class UsageError extends Error {}
function output(value: unknown, json: boolean) {
	stdout.write(
		json
			? `${JSON.stringify(value)}\n`
			: `${typeof value === "string" ? value : inspect(value, { colors: stdout.isTTY, depth: 10 })}\n`,
	);
}
async function print(value: Promise<unknown>, json: boolean) {
	output(await value, json);
	return 0;
}
function fail(error: unknown, json: boolean, code = 1): number {
	const message = error instanceof Error ? error.message : String(error);
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
	const socket = createConnection(join(home, ".yonder", "plugins", "channel-cli", `${instance}.sock`));
	socket.setEncoding("utf8");
	const lines = createInterface({ input: socket, crlfDelay: Infinity });
	const terminal = createInterface({ input: stdin, output: stdout, terminal: stdin.isTTY });
	let streamed = "";
	const fromOutput = (part: OutputPart | { type: "message"; text: string } | { type: "error"; message: string }) => {
		if (part.type === "text") {
			streamed += part.delta;
			if (json) output(part, true);
			else stdout.write(part.delta);
		} else if (part.type === "final") {
			if (!streamed) {
				if (json) output(part, true);
				else if (part.text) stdout.write(`${part.text}\n`);
			} else if (!json) stdout.write("\n");
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
		});
		for await (const line of terminal) {
			if (socket.destroyed) break;
			socket.write(`${line}\n`);
		}
		socket.end();
		await new Promise<void>((resolve) => socket.once("close", resolve));
	} finally {
		terminal.close();
		socket.destroy();
	}
}

async function run(args: string[]): Promise<number> {
	if (args.length === 0 || args[0] === "--help" || args[0] === "help") {
		stdout.write(usage);
		return 0;
	}
	const options = parseGlobal(args);
	const [command, ...rest] = options.rest;
	if (options.help) {
		stdout.write(command === "skills" ? `${skillsUsage}\n` : usage);
		return 0;
	}
	if (!command) throw new UsageError(usage);
	if (command === "init") {
		const ownerIndex = rest.indexOf("--owner");
		const owner = ownerIndex >= 0 ? rest[ownerIndex + 1] : "owner";
		const target = rest.find(
			(value, index) => !value.startsWith("-") && !(ownerIndex >= 0 && index === ownerIndex + 1),
		);
		if (ownerIndex >= 0 && !owner) throw new UsageError("init --owner requires an id");
		if (
			rest.some((value) => value.startsWith("-") && value !== "--owner") ||
			rest.filter((value, index) => !value.startsWith("-") && !(ownerIndex >= 0 && index === ownerIndex + 1)).length > 1
		)
			throw new UsageError("Usage: yonder init [dir] [--owner <id>]");
		const home = homeFor(options, true, target);
		return print(initHome(home, owner), options.json);
	}
	if (command === "login") {
		const provider = rest[0];
		if (!provider || rest.length !== 1) throw new UsageError("Usage: yonder login <provider>");
		const home = homeFor(options);
		const interaction: LoginInteraction = {
			async prompt(prompt) {
				stderr.write(`${prompt.message}\n`);
				const terminal = createInterface({ input: stdin, output: stderr });
				try {
					return await new Promise<string>((resolve) => terminal.question("> ", resolve));
				} finally {
					terminal.close();
				}
			},
			notify(event) {
				stderr.write(`${JSON.stringify(event)}\n`);
			},
		};
		await loginProvider(home, provider, interaction);
		output({ ok: true, provider }, options.json);
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
	if (command === "skills") {
		let agent = "main";
		let profile: string | undefined;
		for (let i = 0; i < rest.length; i++) {
			const option = rest[i];
			const value = rest[i + 1];
			if ((option !== "--agent" && option !== "--profile") || !value || value.startsWith("--"))
				throw new UsageError(skillsUsage);
			if (option === "--agent") agent = value;
			else profile = value;
			i++;
		}
		return print(inspectSkills(homeFor(options), agent, profile), options.json);
	}
	if (command === "start") {
		if (rest.length) throw new UsageError("Usage: yonder start");
		const home = homeFor(options);
		env.YONDER_HOME = home;
		const kernel = await openKernel(home, {
			log: (level, message, data) => output({ level, message, ...(data ? { data } : {}) }, options.json),
		});
		let closing: Promise<void> | undefined;
		let control: Awaited<ReturnType<typeof serveControl>>;
		let finish!: () => void;
		const stopped = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const stop = () => {
			if (closing) return closing;
			closing = (async () => {
				await control?.close();
				await kernel.close();
				finish();
			})();
			return closing;
		};
		try {
			control = await serveControl(home, async (request) => {
				const params = (request.params ?? {}) as Record<string, unknown>;
				switch (request.method) {
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
		const channelIndex = rest.indexOf("--channel");
		const instance = channelIndex >= 0 ? rest[channelIndex + 1] : "cli";
		if (
			!instance ||
			rest.some((value) => value.startsWith("-") && value !== "--channel") ||
			(channelIndex >= 0 && rest.length !== 2)
		)
			throw new UsageError("Usage: yonder chat [--channel <instance>]");
		await chat(homeFor(options), instance, options.json);
		return 0;
	}
	if (command === "sessions") {
		const [subcommand, ...args2] = rest;
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
		throw new UsageError("Usage: yonder sessions list|show <id>|abort <id>|close <id>");
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
	throw new UsageError(`Command not implemented in this task: ${command}`);
}

export async function main(args = process.argv.slice(2)) {
	try {
		return await run(args);
	} catch (error) {
		return fail(error, args.includes("--json"), error instanceof UsageError ? 2 : 1);
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	process.exitCode = await main();
}
