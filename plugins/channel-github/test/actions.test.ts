import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginAPI, YEvent } from "@yonder/sdk";
import { describe, expect, it, vi } from "vitest";
import { applyRelease, notifyUpdate } from "../src/actions.js";
import { GithubChannel } from "../src/channel.js";

// Function injection checks the program consumer; no model, GitHub or launchd runs.
const api = { version: "0.1.3", paths: { data: "/unused" } } as PluginAPI;
function input(policy: "notify" | "apply" = "apply") {
	const channel = new GithubChannel(
		"project",
		{
			repository: "GoYonderTogether/yonder-harness",
			accounts: ["GoYonderTogether"],
			labels: ["yonder-task"],
			releases: {
				approvedAuthors: ["GoYonderTogether"],
				policy,
				updater: { install: "/unused/install", home: "/unused/home" },
			},
		},
		api,
	);
	const event: YEvent = {
		id: "check",
		ts: new Date().toISOString(),
		type: "channel-github.release",
		from: "plugin:channel-github",
		conv: "conv:project:GoYonderTogether/yonder-harness:releases",
		data: { repository: channel.config.repository, releaseId: "1", tag: "v0.1.4" },
	};
	const release = {
		id: 1,
		tag_name: "v0.1.4",
		draft: false,
		prerelease: false,
		published_at: "2026-10-19T00:00:00Z",
		author: { login: "GoYonderTogether" },
		html_url: "https://github.com/GoYonderTogether/yonder-harness/releases/tag/v0.1.4",
	};
	return { channel, event, release, channels: new Map([[channel.id, channel]]) };
}
describe("program release consumer", () => {
	it("re-reads the release and calls the shared function without a ToolContext", async () => {
		const { channel, event, release, channels } = input();
		const get = vi.spyOn(channel.client, "get").mockResolvedValue(release);
		const schedule = vi.fn().mockResolvedValue({ scheduled: true });
		await applyRelease(api, channels, event, schedule);
		expect(get.mock.calls[0]?.[0]).toBe("repos/GoYonderTogether/yonder-harness/releases/1");
		expect(schedule).toHaveBeenCalledWith(api, channel, release, expect.any(AbortSignal), { defer: true });
	});
	it.each(["0.1.4", "0.1.5"])("does not schedule a release at or below host %s", async (version) => {
		const { channel, event, release, channels } = input();
		vi.spyOn(channel.client, "get").mockResolvedValue(release);
		const schedule = vi.fn();
		await applyRelease({ ...api, version }, channels, event, schedule);
		expect(schedule).not.toHaveBeenCalled();
	});
	it("does nothing for notify policy or a foreign instance/repository/source", async () => {
		for (const change of [
			{},
			{ conv: "conv:other:GoYonderTogether/yonder-harness:releases" },
			{ from: "acct:other:user" },
			{ data: { repository: "other/repo", releaseId: "1" } },
		]) {
			const { channel, event, channels } = input(Object.keys(change).length ? "apply" : "notify");
			const get = vi.spyOn(channel.client, "get");
			const schedule = vi.fn();
			await applyRelease(api, channels, { ...event, ...change }, schedule);
			expect(get).not.toHaveBeenCalled();
			expect(schedule).not.toHaveBeenCalled();
		}
	});
	it.each([{ author: { login: "other" } }, { draft: true }, { prerelease: true }, { id: 2 }, { tag_name: "v0.1.5" }])(
		"rejects changed release approval or identity %j",
		async (change) => {
			const { channel, event, release, channels } = input();
			vi.spyOn(channel.client, "get").mockResolvedValue({ ...release, ...change });
			const schedule = vi.fn();
			await expect(applyRelease(api, channels, event, schedule)).rejects.toThrow();
			expect(schedule).not.toHaveBeenCalled();
		},
	);
});

describe("program update notifications", () => {
	it("retains unknown delivery and does not resend the same update", async () => {
		const directory = await mkdtemp(join(tmpdir(), "yonder-actions-"));
		try {
			const { channel, channels } = input();
			Object.assign(channel.config.releases ?? {}, { notifyUpdates: true, notifyTarget: "conv:feishu:target" });
			const send = vi.fn().mockResolvedValue({ ok: false, uncertain: true, error: "response lost" });
			const current = { ...api, paths: { data: directory }, messages: { send } } as unknown as PluginAPI;
			const event: YEvent = {
				id: "receipt",
				ts: new Date().toISOString(),
				type: "release.update-result",
				data: {
					updateId: "12345678-1234-1234-1234-123456789012",
					repository: "https://github.com/GoYonderTogether/yonder-harness.git",
					install: "/unused/install",
					home: "/unused/home",
					version: "0.1.4",
					verified: true,
					status: "verified",
				},
			};
			await notifyUpdate(current, channels, { ...event, data: { ...event.data, home: "/other" } });
			expect(send).not.toHaveBeenCalled();
			await notifyUpdate(current, channels, event);
			await notifyUpdate(current, channels, { ...event, id: "duplicate" });
			expect(send).toHaveBeenCalledExactlyOnceWith({ to: "conv:feishu:target", text: "Yonder 0.1.4 已更新并核验。" });
			const saved = JSON.parse(
				await readFile(join(directory, "project.notifications", "12345678-1234-1234-1234-123456789012.json"), "utf8"),
			);
			expect(saved.delivery).toMatchObject({ ok: false, uncertain: true });
			Object.assign(channel.config.releases ?? {}, { notifyUpdates: false });
			await notifyUpdate(current, channels, {
				...event,
				data: { ...event.data, updateId: "22345678-1234-1234-1234-123456789012" },
			});
			expect(send).toHaveBeenCalledTimes(1);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
	it.each(["failed-or-unknown", "restart-required"])("does not claim verified success for %s", async (status) => {
		const directory = await mkdtemp(join(tmpdir(), "yonder-actions-"));
		try {
			const { channel, channels } = input();
			Object.assign(channel.config.releases ?? {}, { notifyUpdates: true, notifyTarget: "conv:feishu:target" });
			const send = vi.fn().mockResolvedValue({ ok: true });
			await notifyUpdate({ ...api, paths: { data: directory }, messages: { send } } as unknown as PluginAPI, channels, {
				id: "failure",
				ts: new Date().toISOString(),
				type: "release.update-result",
				data: {
					updateId: "12345678-1234-1234-1234-123456789012",
					repository: "https://github.com/GoYonderTogether/yonder-harness.git",
					install: "/unused/install",
					home: "/unused/home",
					verified: false,
					status,
				},
			});
			expect(send).toHaveBeenCalledTimes(1);
			expect(send.mock.calls[0]?.[0].text).not.toContain("已更新并核验");
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});
