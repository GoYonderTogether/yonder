import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { assertExpectedTarget, autoReleaseDecision } from "./auto-release.mjs";

const repository = "GoYonderTogether/yonder";
const sha = "a".repeat(40);
const otherSha = "b".repeat(40);
const workflow = { id: 391193209, path: ".github/workflows/ci.yml" };
function input() {
	const run = {
		id: 41279589830,
		run_attempt: 1,
		workflow_id: workflow.id,
		path: workflow.path,
		event: "push",
		head_branch: "main",
		head_sha: sha,
		status: "completed",
		conclusion: "success",
		repository: { full_name: repository },
		head_repository: { full_name: repository },
	};
	return {
		event: { action: "completed", workflow_run: structuredClone(run) },
		run,
		workflow,
		repository,
		mainSha: sha,
	};
}

test("only an API-verified successful current main push can dispatch", () => {
	assert.deepEqual(autoReleaseDecision(input()), { eligible: true, sha });
});

for (const patch of [
	{ event: "pull_request" },
	{ event: "workflow_dispatch" }, // Post-release tag CI must not trigger another release.
	{ head_branch: "v0.3.26110102" },
	{ head_branch: "feature" },
	{ conclusion: "failure" },
	{ conclusion: "cancelled" },
	{ conclusion: "skipped" },
	{ conclusion: "neutral" },
	{ status: "in_progress" },
	{ path: ".github/workflows/other.yml" },
	{ workflow_id: workflow.id + 1 },
	{ head_repository: { full_name: "fork/yonder" } },
	{ repository: { full_name: "fork/yonder" } },
	{ head_sha: "main" },
	{ run_attempt: undefined },
]) {
	test(`reject an untrusted source or fresh API result: ${JSON.stringify(patch)}`, () => {
		for (const target of ["run", "event"]) {
			const state = input();
			Object.assign(target === "run" ? state.run : state.event.workflow_run, patch);
			assert.equal(autoReleaseDecision(state).eligible, false);
		}
	});
}

test("cross-check API identity and reject old attempts, missing events and wrong official workflow", () => {
	for (const patch of [{ id: 42 }, { run_attempt: 2 }, { head_sha: otherSha }]) {
		const state = input();
		Object.assign(state.run, patch);
		assert.equal(autoReleaseDecision(state).eligible, false);
	}
	assert.equal(autoReleaseDecision({ ...input(), event: undefined }).eligible, false);
	assert.equal(autoReleaseDecision({ ...input(), workflow: { ...workflow, path: "other" } }).eligible, false);
});

test("ignore stale CI and commits already released directly or by a release child", () => {
	assert.equal(autoReleaseDecision({ ...input(), mainSha: otherSha }).eligible, false);
	for (const commit of [
		{ sha, parents: [], tags: ["v0.3.26110102"], subject: "release" },
		{ sha: otherSha, parents: [sha], tags: ["v0.3.26110102"], subject: "chore(release): 0.3.26110102" },
	]) {
		assert.equal(autoReleaseDecision({ ...input(), taggedCommits: [commit] }).eligible, false);
	}
});

test("release queue rechecks exact SHA instead of forwarding to a newer main", () => {
	assert.doesNotThrow(() => assertExpectedTarget(sha, sha));
	for (const expected of ["main", "", undefined, otherSha]) {
		assert.throws(() => assertExpectedTarget(expected, sha), /expected_sha/);
	}
	assert.throws(() => assertExpectedTarget(sha, otherSha), /main/);
});

test("workflow wiring retains a forced CI gate and the official atomic/draft publishing path", () => {
	const read = (file) => readFileSync(new URL(`../../.github/workflows/${file}`, import.meta.url), "utf8");
	const release = read("release.yml");
	assert.match(release, /require_ci:[\s\S]*?default: true/);
	assert.match(release, /inputs\.require_ci \|\| inputs\.expected_sha != ''/);
	assert.ok(release.indexOf("--assert-target") < release.indexOf("git merge --ff-only origin/main"));
	assert.ok(release.indexOf("ci-status.mjs") < release.indexOf("version.mjs --assert-unreleased"));
	assert.match(release, /git push --atomic/);
	assert.ok(release.indexOf("核对附件齐全") < release.indexOf("--draft=false --latest"));
	const automatic = read("auto-release.yml");
	assert.match(automatic, /workflow_run:/);
	assert.match(automatic, /types: \[completed\]/);
	assert.match(automatic, /branches: \[main\]/);
	assert.doesNotMatch(automatic, /contents: write/);
	assert.doesNotMatch(read("ci.yml"), /continue-on-error: true/);
	assert.match(read("ci.yml"), /node --test scripts\/release\/auto-release.test.mjs/);
});
