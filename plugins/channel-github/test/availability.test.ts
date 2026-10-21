import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChannelIO, PluginAPI, RenderContext } from "@yonder/sdk";
import { expect, it, vi } from "vitest";
import { releaseAvailability } from "../src/availability.js";
import { Github } from "../src/client.js";
import { compareVersions, Releases } from "../src/releases.js";

it("caches approved baseline metadata; selected turn context only suggests a strictly newer version without requests", async () => {
	const directory = await mkdtemp(join(tmpdir(), "yonder-availability-"));
	try {
		const api = { paths: { data: directory }, log: { warn: vi.fn() } } as unknown as PluginAPI;
		const releases = new Releases(
			"project",
			"GoYonderTogether/yonder-harness",
			{ approvedAuthors: ["GoYonderTogether"] },
			api,
		);
		const client = new Github("GoYonderTogether/yonder-harness");
		const release = (id: number, version: string, extra = {}) => ({
			id,
			tag_name: `v${version}`,
			author: { login: "GoYonderTogether" },
			html_url: `https://github.com/GoYonderTogether/yonder-harness/releases/tag/v${version}`,
			published_at: "2026-10-19T00:00:00Z",
			draft: false,
			prerelease: false,
			body: "External release body must not enter context",
			...extra,
		});
		const list = vi
			.spyOn(client, "list")
			.mockResolvedValue([
				release(1, "0.1.2026101905"),
				release(2, "0.1.2026101906"),
				release(3, "99.0.0", { author: { login: "other" } }),
				release(4, "98.0.0", { draft: true }),
				release(5, "97.0.0", { prerelease: true }),
				release(6, "96.0.0", { html_url: "https://example.com/release" }),
				release(7, "95.0.0-beta"),
			]);
		const emit = vi.fn();
		await releases.poll(client, { emit } as unknown as ChannelIO, new AbortController().signal);
		expect(emit).not.toHaveBeenCalled();
		expect(releases.latest?.version).toBe("0.1.2026101906");
		const cached = JSON.parse(await readFile(join(directory, "project.releases.json"), "utf8"));
		expect(cached.latest).toEqual(releases.latest);
		expect(cached.latest.body).toBeUndefined();
		const context = releaseAvailability(() => [releases], "0.1.2026101905");
		expect(context.placement).toBe("turn");
		const rendered = await context.render({} as RenderContext);
		expect(rendered).toContain('"externalContent":true');
		expect(rendered).toContain("0.1.2026101906");
		expect(rendered).not.toContain("External release body");
		for (const version of ["0.1.2026101906", "0.1.2026101907", "0.2.0"])
			expect(await releaseAvailability(() => [releases], version).render({} as RenderContext)).toBeUndefined();
		expect(list).toHaveBeenCalledTimes(1);
		expect(compareVersions("1.0.9007199254740993", "1.0.9007199254740992")).toBe(1);
		expect(compareVersions("1.10.0", "1.9.99")).toBe(1);
		expect(() => compareVersions("1.0.0-beta", "1.0.0")).toThrow();
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
