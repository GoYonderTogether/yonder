import { stderr, stdout } from "node:process";
import {
	checkRelease,
	compareVersions,
	readChangelog,
	readDocs,
	releaseInfo,
	requestControl,
	updateRelease,
} from "@yonder/core";
import type { SessionInfo } from "@yonder/sdk";
import { completion } from "../completion.js";
import {
	connectionUnavailable,
	namedOptions,
	type Options,
	optionalHome,
	output,
	print,
	releaseUsage,
	UsageError,
} from "./context.js";

/** `completion`, `version`, `changelog`, `docs` and `update`: no kernel, at most a control socket. */
export async function runRelease(command: string, options: Options, rest: string[]): Promise<number | undefined> {
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
	if (command !== "update") return undefined;
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
