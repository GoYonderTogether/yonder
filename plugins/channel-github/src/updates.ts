import { execFile } from "node:child_process";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { ChannelIO, PluginAPI } from "@yonder/sdk";
import type { GithubChannel } from "./channel.js";
import { nativeId, type ObjectValue, object } from "./client.js";
import { approvedRelease, releaseData } from "./releases.js";
import { windowsUpdateJob } from "./windows-jobs.js";

const exec = promisify(execFile);
const xml = (value: string) =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
const jobs = (api: PluginAPI, instance: string) => join(api.paths.data, `${instance}.updates`);
const domain = () => `gui/${process.getuid?.()}`;
const label = (instance: string, releaseId: string) => `dev.yonder.github-update.${instance}.${releaseId}`;
async function launch(args: string[], signal: AbortSignal) {
	return exec("/bin/launchctl", args, { signal, timeout: 10_000, maxBuffer: 256_000 });
}
export async function readUpdate(
	api: PluginAPI,
	instance: string,
	releaseId: string,
	signal: AbortSignal,
): Promise<ObjectValue> {
	const directory = join(jobs(api, instance), nativeId(releaseId));
	const request = object(JSON.parse(await readFile(join(directory, "request.json"), "utf8")));
	let result: unknown;
	try {
		result = JSON.parse(await readFile(join(directory, "result.json"), "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	let loaded = false,
		job: string | undefined;
	try {
		job =
			process.platform === "win32"
				? await windowsUpdateJob("status", directory, signal)
				: (await launch(["print", `${domain()}/${label(instance, releaseId)}`], signal)).stdout;
		loaded = process.platform === "win32" ? job === "Running" : true;
	} catch (error) {
		if (signal.aborted) throw error;
	}
	return {
		request,
		result: result ?? null,
		jobLoaded: loaded,
		job: job ?? null,
		status: result ? "finished" : loaded ? "scheduled-or-running" : "not-running-outcome-unknown",
	};
}
const scheduling = new Set<string>();
export async function scheduleUpdate(
	api: PluginAPI,
	channel: GithubChannel,
	release: ObjectValue,
	signal: AbortSignal,
	options: { defer?: boolean } = {},
): Promise<ObjectValue> {
	if (scheduling.has(channel.id)) throw new Error("An update scheduling call is already in progress for this instance");
	scheduling.add(channel.id);
	try {
		return await dispatchUpdate(api, channel, release, signal, options);
	} finally {
		scheduling.delete(channel.id);
	}
}
async function dispatchUpdate(
	api: PluginAPI,
	channel: GithubChannel,
	release: ObjectValue,
	signal: AbortSignal,
	scheduleOptions: { defer?: boolean } = {},
): Promise<ObjectValue> {
	if (!["darwin", "win32"].includes(process.platform))
		throw new Error("Service-external updates require macOS launchd or Windows Task Scheduler");
	const options = channel.config.releases;
	if (!options || options.policy !== "apply" || !options.updater)
		throw new Error("Update application is not approved/configured; default policy is notify");
	if (!approvedRelease(release, options))
		throw new Error("Release is draft/prerelease or author is not explicitly approved");
	const data = releaseData(channel.config.repository, release);
	const target = options.updater;
	const install = resolve(target.install),
		home = resolve(target.home);
	// One OS job per immutable release identity. No resubmission when an external outcome is unknown.
	const root = jobs(api, channel.id),
		directory = join(root, data.releaseId);
	await mkdir(root, { recursive: true });
	for (const id of (await readdir(root)).filter((value) => /^[1-9][0-9]*$/.test(value) && value !== data.releaseId)) {
		try {
			await readFile(join(root, id, "result.json"));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			throw new Error(
				`Another update (${id}) has no terminal receipt; query its status before scheduling a different release`,
			);
		}
	}
	try {
		await mkdir(directory);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") return readUpdate(api, channel.id, data.releaseId, signal);
		throw error;
	}
	const request = {
		...data,
		instance: channel.id,
		install,
		home,
		result: join(directory, "result.json"),
		...(scheduleOptions.defer ? { defer: true } : {}),
		path: process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin",
	};
	const requestPath = join(directory, "request.json");
	let dispatched = false;
	try {
		await writeFile(requestPath, JSON.stringify(request), { mode: 0o600 });
		// Copy the standalone runner outside versions/current before restarting/pruning the service.
		const script = join(directory, "update-job.mjs");
		await copyFile(fileURLToPath(new URL("./update-job.js", import.meta.url)), script);
		if (process.platform === "win32") {
			signal.throwIfAborted();
			dispatched = true;
			try {
				await windowsUpdateJob("start", directory, signal);
			} catch (cause) {
				throw new Error(
					`Windows update dispatch failed or is uncertain; query update_status for release ${data.releaseId}; do not resubmit.`,
					{ cause },
				);
			}
			return {
				scheduled: true,
				verified: false,
				repository: data.repository,
				releaseId: data.releaseId,
				tag: data.tag,
				version: data.version,
				result: request.result,
				message: "Independent Windows task owns update; query status for verified receipt.",
			};
		}
		const plist = join(directory, "job.plist"),
			id = label(channel.id, data.releaseId);
		const pair = (key: string, value: string) => `<key>${key}</key><string>${xml(value)}</string>`;
		await writeFile(
			plist,
			`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>${pair("Label", id)}<key>ProgramArguments</key><array>${[process.execPath, script, requestPath].map((arg) => `<string>${xml(arg)}</string>`).join("")}</array><key>RunAtLoad</key><true/><key>KeepAlive</key><false/>${pair("StandardOutPath", join(directory, "job.log"))}${pair("StandardErrorPath", join(directory, "job.log"))}</dict></plist>`,
			{ mode: 0o600 },
		);
		signal.throwIfAborted();
		dispatched = true;
		try {
			await launch(["bootstrap", domain(), plist], signal);
		} catch (error) {
			throw new Error(
				`launchd update dispatch failed or is uncertain: ${String(error)}. Query update_status for release ${data.releaseId}; do not resubmit.`,
			);
		}
		return {
			scheduled: true,
			verified: false,
			label: id,
			repository: data.repository,
			releaseId: data.releaseId,
			tag: data.tag,
			version: data.version,
			result: request.result,
			message:
				"Independent launchd job owns update; scheduled is not installed. Query status; restart recovery emits final evidence.",
		};
	} catch (error) {
		if (!dispatched) await rm(directory, { recursive: true, force: true });
		throw error;
	}
}
export async function recoverUpdates(
	api: PluginAPI,
	instance: string,
	repository: string,
	io: ChannelIO,
	signal: AbortSignal,
): Promise<void> {
	let directories: string[];
	try {
		directories = await readdir(jobs(api, instance));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
	for (const id of directories.filter((value) => /^[1-9][0-9]*$/.test(value))) {
		signal.throwIfAborted();
		const directory = join(jobs(api, instance), id);
		try {
			await readFile(join(directory, "reported"));
			continue;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		let result: ObjectValue;
		try {
			result = object(JSON.parse(await readFile(join(directory, "result.json"), "utf8")));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
			throw error;
		}
		if (result.repository !== repository || result.instance !== instance || String(result.releaseId) !== id)
			throw new Error("Update receipt identity does not match configured channel");
		await io.emit({
			type: "channel-github.update-result",
			from: "plugin:channel-github",
			conv: `conv:${instance}:${repository}:releases`,
			data: { ...result, msgId: `update:${id}:result`, notified: false },
		});
		await writeFile(join(directory, "reported"), new Date().toISOString(), { mode: 0o600 });
		try {
			if (process.platform === "win32") await windowsUpdateJob("remove", directory, signal);
			else await launch(["bootout", `${domain()}/${label(instance, id)}`], signal);
		} catch (error) {
			if (signal.aborted) throw error;
			api.log.warn("Finished update launchd job could not be unloaded", {
				instance,
				releaseId: id,
				error: String(error),
			});
		}
	}
}
