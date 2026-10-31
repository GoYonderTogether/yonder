#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { env, stdin, stdout } from "node:process";
import { pathToFileURL } from "node:url";
import { installedService } from "@yonder/core";
import { runAccount } from "./commands/account.js";
import { runChannels } from "./commands/channels.js";
import { runChat } from "./commands/chat.js";
import { runConfig } from "./commands/config.js";
import {
	chatUsage,
	fail,
	optionalHome,
	output,
	parseGlobal,
	releaseUsage,
	sessionsUsage,
	skillsUsage,
	UsageError,
	usage,
} from "./commands/context.js";
import { runRelease } from "./commands/release.js";
import { runRuntime } from "./commands/runtime.js";

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
				: join(homedir(), ".local/share/yonder/home"));
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
	const handlers = [runRelease, runChannels, runAccount, runConfig, runRuntime];
	for (const handler of handlers) {
		const result = await handler(command, options, rest);
		if (result !== undefined) return result;
	}
	const result = await runChat(command, options, rest, daily);
	if (result !== undefined) return result;
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
