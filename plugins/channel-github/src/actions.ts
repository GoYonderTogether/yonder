import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { PluginAPI, YEvent } from "@yonder/sdk";
import type { GithubChannel } from "./channel.js";
import { object } from "./client.js";
import { approvedRelease, compareVersions, releaseData, repositoryNames } from "./releases.js";
import { scheduleUpdate } from "./updates.js";

export async function applyRelease(
	api: PluginAPI,
	channels: Map<string, GithubChannel>,
	event: YEvent,
	schedule = scheduleUpdate,
): Promise<void> {
	if (event.type !== "channel-github.release" || event.from !== "plugin:channel-github") return;
	const data = object(event.data);
	const channel = [...channels.values()].find(
		(value) => event.conv === `conv:${value.id}:${value.config.repository}:releases`,
	);
	const options = channel?.config.releases;
	if (!channel || !options || options.policy !== "apply" || !options.updater) return;
	if (data.repository !== channel.config.repository || !/^[1-9][0-9]*$/.test(String(data.releaseId))) return;
	const signal = AbortSignal.timeout(30_000);
	const release = object(await channel.client.get(channel.client.path(`releases/${data.releaseId}`), signal));
	const current = releaseData(channel.config.repository, release);
	if (current.releaseId !== data.releaseId || current.tag !== data.tag || !approvedRelease(release, options))
		throw new Error("Release event no longer matches an approved published release");
	if (compareVersions(current.version, api.version) <= 0) return;
	await schedule(api, channel, release, signal, { defer: true });
}

export async function notifyUpdate(api: PluginAPI, channels: Map<string, GithubChannel>, event: YEvent): Promise<void> {
	if (event.type !== "release.update-result") return;
	const data = object(event.data);
	if (
		typeof data.updateId !== "string" ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.updateId)
	)
		return;
	if (!["verified", "failed-or-unknown", "restart-required"].includes(String(data.status))) return;
	if (typeof data.verified !== "boolean") return;
	for (const channel of channels.values()) {
		const options = channel.config.releases;
		if (!options?.notifyUpdates || !options.notifyTarget || !options.updater) continue;
		if (
			!repositoryNames(channel.config.repository).some(
				(name) => data.repository === `https://github.com/${name}.git`,
			) ||
			data.install !== resolve(options.updater.install) ||
			data.home !== resolve(options.updater.home)
		)
			continue;
		const directory = join(api.paths.data, `${channel.id}.notifications`);
		await mkdir(directory, { recursive: true });
		const file = join(directory, `${data.updateId}.json`);
		try {
			await writeFile(
				file,
				JSON.stringify({
					eventId: event.id,
					updateId: data.updateId,
					status: "attempted",
					target: options.notifyTarget,
				}),
				{ flag: "wx", mode: 0o600 },
			);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
			throw error;
		}
		const version = typeof data.version === "string" ? ` ${data.version}` : "";
		const reason =
			typeof data.error === "string" && data.error.trim()
				? `：${data.error.replace(/\s+/g, " ").trim().slice(0, 100)}`
				: "，结果没有得到确认";
		const text =
			data.verified === true && data.status === "verified"
				? `Yonder${version} 已更新并核验。`
				: data.status === "restart-required"
					? `Yonder${version} 已安装，服务仍需重启，尚未确认运行版本。`
					: `Yonder${version} 更新没有成功${reason}。`;
		let delivery: unknown;
		try {
			delivery = await api.messages.send({ to: options.notifyTarget, text });
		} catch (error) {
			delivery = { ok: false, uncertain: true, error: String(error) };
		}
		await writeFile(
			file,
			JSON.stringify({ eventId: event.id, updateId: data.updateId, target: options.notifyTarget, delivery }),
			{ mode: 0o600 },
		);
	}
}
