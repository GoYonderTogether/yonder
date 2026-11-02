import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const { test } = process.env.VITEST ? await import("vitest") : await import("node:test");
const repository = "https://github.com/GoYonderTogether/pi.git";

function fixture(run) {
	const root = mkdtempSync(join(tmpdir(), "sync-pi-durable-test-"));
	const fork = join(root, "fork");
	const harness = join(root, "harness");
	const target = join(harness, "packages/pi-durable");
	const put = (path, content) => {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, content);
	};
	const git = (...args) => execFileSync("git", args, { cwd: fork, encoding: "utf8" }).trim();
	try {
		// Keep exact source bytes stable when the fixture is checked out with Windows autocrlf.
		put(join(fork, ".gitattributes"), "* text eol=lf\n");
		put(join(fork, "packages/durable/src/index.ts"), "export const revision = 1;\n");
		put(
			join(fork, "packages/durable/package.json"),
			JSON.stringify({ name: "@earendil-works/pi-durable", version: "1.3.0" }),
		);
		for (const path of ["LICENSE", "packages/durable/CHANGELOG.md", "packages/durable/FORK.md"])
			put(join(fork, path), `${path}\n`);
		git("init", "--quiet");
		git("remote", "add", "origin", repository);
		const commit = () => {
			git("add", ".");
			git(
				"-c",
				"user.name=Sync test",
				"-c",
				"user.email=sync@example.invalid",
				"-c",
				"commit.gpgsign=false",
				"commit",
				"--quiet",
				"-m",
				"source revision",
			);
			return git("rev-parse", "HEAD");
		};
		const pin = commit();
		cpSync(join(fork, "packages/durable"), target, { recursive: true });
		put(join(target, "FORK_SOURCE.json"), JSON.stringify({ repository, commit: pin }));
		put(join(fork, "packages/durable/src/index.ts"), "export const revision = 2;\n");
		const next = commit();
		mkdirSync(join(harness, "scripts"));
		cpSync(new URL("./sync-pi-durable.mjs", import.meta.url), join(harness, "scripts/sync-pi-durable.mjs"));
		const sync = (ref) =>
			spawnSync(process.execPath, [join(harness, "scripts/sync-pi-durable.mjs"), ref], {
				cwd: harness,
				env: { ...process.env, YONDER_PI_SOURCE: fork },
				encoding: "utf8",
			});
		run({ target, pin, next, sync, put });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function snapshot(root) {
	return readdirSync(root, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => [
			join(entry.parentPath, entry.name).slice(root.length),
			readFileSync(join(entry.parentPath, entry.name), "utf8"),
		])
		.sort(([a], [b]) => a.localeCompare(b));
}

for (const requested of ["pin", "next"]) {
	test(`unchanged recorded source can sync to ${requested}`, () =>
		fixture(({ target, pin, next, sync }) => {
			const ref = requested === "pin" ? pin : next;
			const result = sync(ref);
			assert.equal(result.status, 0, result.stderr);
			assert.equal(JSON.parse(readFileSync(join(target, "FORK_SOURCE.json"), "utf8")).commit, ref);
			assert.equal(
				readFileSync(join(target, "src/index.ts"), "utf8"),
				`export const revision = ${requested === "pin" ? 1 : 2};\n`,
			);
		}));

	for (const change of ["modified", "added", "deleted"]) {
		test(`${change} local source refuses ${requested} sync without changing target`, () =>
			fixture(({ target, pin, next, sync, put }) => {
				if (change === "modified") put(join(target, "src/index.ts"), "export const anchorsFor = () => [];\n");
				if (change === "added") put(join(target, "src/tools/anchors.ts"), "export const anchorOwners = new Map();\n");
				if (change === "deleted") rmSync(join(target, "src/index.ts"));
				const before = snapshot(target);
				const result = sync(requested === "pin" ? pin : next);
				assert.notEqual(result.status, 0);
				assert.match(result.stderr, /sync refused before replacement/);
				assert.deepEqual(snapshot(target), before);
			}));
	}
}

test("unavailable recorded commit fails closed without replacing source", () =>
	fixture(({ target, next, sync, put }) => {
		put(join(target, "FORK_SOURCE.json"), JSON.stringify({ repository, commit: "0".repeat(40) }));
		const before = snapshot(target);
		assert.notEqual(sync(next).status, 0);
		assert.deepEqual(snapshot(target), before);
	}));
