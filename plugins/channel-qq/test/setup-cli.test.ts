import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { tempHome } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { groupInstructions, groupTools, legacyGroupInstructions } from "../src/participation.js";
import { upgradeGroups } from "../src/setup.js";

test("upgrade-groups runs through the installed setup symlink instead of silently exiting", async () => {
	const home = await tempHome("yonder-qq-cli-");
	try {
		await writeFile(join(home, "yonder.yaml"), "schema: 1\nagents: []\n");
		const cli = join(home, "setup.js");
		await symlink(fileURLToPath(new URL("../dist/setup.js", import.meta.url)), cli);
		const { stdout, stderr } = await promisify(execFile)(process.execPath, [cli, "upgrade-groups", "--home", home]);
		expect(stderr).toBe("");
		expect(JSON.parse(stdout)).toEqual({ changed: [], skipped: [], preview: [], applied: false });
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

const officialProfile = (extra: object = {}) => ({
	capabilities: ["read"],
	instructions: legacyGroupInstructions,
	contexts: ["peer-workspace"],
	tools: { offer: [...groupTools], search: [] },
	plugins: [],
	skills: [],
	...extra,
});

/** A home with one migrated candidate and one custom profile/binding that must never be touched. */
async function legacyHome() {
	const home = await tempHome("yonder-qq-migrate-");
	await mkdir(join(home, "agents/main"), { recursive: true });
	await writeFile(
		join(home, "yonder.yaml"),
		stringify({
			schema: 1,
			channels: { "qq-main": { type: "qq", appId: "1", credential: "qq-main" } },
			agents: [{ id: "main", workspace: "./agents/main" }],
		}),
	);
	const file = join(home, "agents/main/agent.yaml");
	await writeFile(
		file,
		stringify({
			schema: 1,
			id: "main",
			name: "Main",
			owner: "person:owner",
			defaultProfile: "owner",
			profiles: {
				owner: { model: "openai/gpt-6-luna" },
				"qq-main-group": officialProfile(),
				custom: { instructions: "自定义群提示", tools: { offer: ["read"] } },
			},
			bindings: [
				{
					id: "qq-main-group",
					match: { channel: "qq-main", kind: "group" },
					session: { mode: "persistent", per: "conv" },
					profile: "qq-main-group",
					wake: "mention",
					reply: "none",
				},
				{
					id: "qq-main-batch",
					match: { type: "channel-qq.group-batch", channel: "qq-main" },
					session: { mode: "persistent", per: "conv" },
					profile: "qq-main-group",
					reply: "none",
				},
				{
					id: "custom-group",
					match: { channel: "qq-main", kind: "group", conv: "conv:qq-main:group:custom" },
					session: { mode: "persistent", per: "conv" },
					profile: "custom",
					wake: "mention",
					reply: "none",
				},
				{
					id: "qq-main-dm",
					match: { channel: "qq-main", kind: "dm", from: "owner" },
					session: "main",
					profile: "owner",
				},
			],
		}),
	);
	return { home, file };
}

test("upgrade-groups previews first, then writes one backup and migrates only official QQ group config", async () => {
	const { home, file } = await legacyHome();
	try {
		const before = await readFile(file, "utf8");
		const preview = await upgradeGroups(home, "main");
		expect(preview.applied).toBe(false);
		expect(preview.changed).toEqual([]);
		expect(preview.preview).toEqual(
			expect.arrayContaining([
				{ file, profile: "qq-main-group" },
				{ file, binding: "qq-main-group" },
				{ file, binding: "qq-main-batch" },
				{ file, binding: "qq-main-parent" },
			]),
		);
		// 预览不写文件，也不留备份。
		expect(await readFile(file, "utf8")).toBe(before);
		expect((await readdir(join(home, "agents/main"))).filter((name) => name.includes(".pre-qq-context-"))).toEqual([]);

		const applied = await upgradeGroups(home, "main", { apply: true });
		expect(applied.changed).toEqual([file]);
		const migrated = parse(await readFile(file, "utf8"));
		expect(migrated.profiles["qq-main-group"]).toMatchObject({
			instructions: groupInstructions,
			plugins: ["social"],
			contexts: ["peer-workspace"],
			skills: [],
		});
		expect(migrated.profiles["qq-main-group"].tools.offer.toSorted()).toEqual(groupTools.toSorted());
		expect(migrated.bindings[0]).toMatchObject({ wake: "write", reply: "none" });
		expect(migrated.bindings[1]).toMatchObject({ match: { type: "social.batch-ready" }, reply: "none" });
		// 自定义配置档与自定义绑定保持原样。
		expect(migrated.profiles.custom).toEqual({ instructions: "自定义群提示", tools: { offer: ["read"] } });
		expect(migrated.bindings[2]).toMatchObject({ id: "custom-group", profile: "custom", wake: "mention" });
		expect(migrated.bindings.at(-1)).toMatchObject({
			id: "qq-main-parent",
			match: { channel: "agent", kind: "parent-request", from: "acct:agent:main" },
			session: "main",
			profile: "owner",
		});

		// 备份是可恢复的原文，且只写一份。
		const backups = (await readdir(join(home, "agents/main"))).filter((name) => name.includes(".pre-qq-context-"));
		expect(backups).toHaveLength(1);
		expect(await readFile(join(home, "agents/main", backups[0]!), "utf8")).toBe(before);

		// 幂等：第二次应用不再改动，也不再写备份。
		expect((await upgradeGroups(home, "main", { apply: true })).changed).toEqual([]);
		expect((await readdir(join(home, "agents/main"))).filter((name) => name.includes(".pre-qq-context-"))).toHaveLength(
			1,
		);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test("upgrade-groups never rewrites a custom group profile that merely mentions the group", async () => {
	const home = await tempHome("yonder-qq-migrate-custom-");
	try {
		await mkdir(join(home, "agents/main"), { recursive: true });
		await writeFile(
			join(home, "yonder.yaml"),
			stringify({
				schema: 1,
				channels: { "qq-main": { type: "qq", appId: "1", credential: "qq-main" } },
				agents: [{ id: "main", workspace: "./agents/main" }],
			}),
		);
		const file = join(home, "agents/main/agent.yaml");
		await writeFile(
			file,
			stringify({
				schema: 1,
				id: "main",
				name: "Main",
				owner: "person:owner",
				defaultProfile: "owner",
				profiles: {
					owner: { model: "openai/gpt-6-luna" },
					// 官方提示词被用户改过：不是 setup 写出的原样，保持不动。
					"qq-main-group": officialProfile({ instructions: `${groupInstructions}\n\n自定义补充` }),
				},
				bindings: [
					{
						id: "qq-main-group",
						match: { channel: "qq-main", kind: "group" },
						session: { mode: "persistent", per: "conv" },
						profile: "qq-main-group",
						wake: "write",
						reply: "none",
					},
				],
			}),
		);
		const before = await readFile(file, "utf8");
		const result = await upgradeGroups(home, "main", { apply: true });
		expect(result.changed).toEqual([]);
		expect(result.preview).toEqual([]);
		expect(await readFile(file, "utf8")).toBe(before);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
