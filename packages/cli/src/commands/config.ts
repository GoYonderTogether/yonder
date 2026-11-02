import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { env } from "node:process";
import { inspectSkills } from "@yonder/core";
import { homeFor, managed, namedOptions, type Options, print, skillsUsage, UsageError } from "./context.js";

function currentInspectContext(home: string) {
	try {
		const value: unknown = JSON.parse(env.YONDER_RUNTIME_INSPECT_CONTEXT ?? "");
		if (typeof value !== "object" || value === null) return undefined;
		const { home: runtimeHome, agent, profile } = value as Record<string, unknown>;
		if (
			typeof runtimeHome === "string" &&
			typeof agent === "string" &&
			agent !== "" &&
			typeof profile === "string" &&
			profile !== "" &&
			resolve(runtimeHome) === resolve(home)
		)
			return { home: runtimeHome, agent, profile };
	} catch {}
	return undefined;
}

/** `agents`/`presets`, `plugins`/`models`/`inspect` and `skills`: management over the control socket. */
export async function runConfig(command: string, options: Options, rest: string[]): Promise<number | undefined> {
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
			if (operation === "add") source = rest[1]?.startsWith(".") || existsSync(rest[1]!) ? resolve(rest[1]!) : rest[1];
			else id = rest[1];
		}
		const home = homeFor(options);
		const runtime = command === "inspect" ? currentInspectContext(home) : undefined;
		const inheritedAgent = Boolean(runtime && !flags["--agent"]);
		const inheritedProfile = Boolean(
			runtime && !flags["--profile"] && (!flags["--agent"] || flags["--agent"] === runtime.agent),
		);
		const agent = flags["--agent"] ?? runtime?.agent;
		const profile = flags["--profile"] ?? (inheritedProfile ? runtime?.profile : undefined);
		const inspection = managed(
			home,
			{
				method: "management",
				params: {
					action,
					...(id ? { id } : {}),
					...(source ? { source } : {}),
					...(agent ? { agent } : {}),
					...(profile ? { profile } : {}),
				},
			},
			true,
		);
		return print(
			command === "inspect" && runtime && (inheritedAgent || inheritedProfile)
				? inspection.then((value) => ({
						...(value as object),
						inspectionContext: {
							source: "current runtime session",
							home: "matched runtime home",
							agent: inheritedAgent ? "current runtime session" : "explicit",
							profile: flags["--profile"] ? "explicit" : inheritedProfile ? "current runtime session" : "agent default",
						},
					}))
				: inspection,
			options.json,
		);
	}
	if (command !== "skills") return undefined;
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
