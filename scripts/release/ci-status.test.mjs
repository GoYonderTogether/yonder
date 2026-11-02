import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateCheckRuns, REQUIRED_CHECKS } from "./ci-status.mjs";

const [MAC, LINUX, WINDOWS, WINDOWS_ARM] = REQUIRED_CHECKS;
const run = (id, name, status, conclusion = null) => ({ id, name, status, conclusion });

test("ci.yml 四个平台 job 都通过时放行，发版 job 自己不影响结果", () => {
	const result = evaluateCheckRuns({
		check_runs: [
			run(1, MAC, "completed", "success"),
			run(2, LINUX, "completed", "success"),
			run(3, WINDOWS, "completed", "success"),
			run(4, WINDOWS_ARM, "completed", "success"),
			run(5, "Tag, CHANGELOG and GitHub Release", "in_progress"),
		],
	});
	assert.equal(result.state, "pass");
});

test("还有未完成的检查时继续等待", () => {
	const result = evaluateCheckRuns({
		check_runs: [
			run(1, MAC, "completed", "success"),
			run(2, LINUX, "in_progress"),
			run(3, WINDOWS, "completed", "success"),
			run(4, WINDOWS_ARM, "completed", "success"),
		],
	});
	assert.equal(result.state, "pending");
	assert.match(result.message, /Linux typecheck, build, test, lint=in_progress/);
});

test("缺少某个必需检查时视为未就绪", () => {
	assert.equal(evaluateCheckRuns({ check_runs: [run(1, MAC, "completed", "success")] }).state, "pending");
	assert.equal(evaluateCheckRuns({}).state, "pending");
});

test("任一检查失败即失败", () => {
	const result = evaluateCheckRuns({
		check_runs: [
			run(1, MAC, "completed", "failure"),
			run(2, LINUX, "completed", "success"),
			run(3, WINDOWS, "completed", "success"),
			run(4, WINDOWS_ARM, "completed", "success"),
		],
	});
	assert.equal(result.state, "fail");
	assert.match(result.message, /macOS typecheck, build, test, lint=failure/);
});

test("同名检查重跑后以最新一次为准", () => {
	const result = evaluateCheckRuns({
		check_runs: [
			run(5, MAC, "completed", "success"),
			run(1, MAC, "completed", "failure"),
			run(2, LINUX, "completed", "success"),
			run(3, WINDOWS, "completed", "success"),
			run(4, WINDOWS_ARM, "completed", "success"),
		],
	});
	assert.equal(result.state, "pass");
});

for (const conclusion of ["neutral", "skipped", "cancelled", "timed_out", "failure", null]) {
	test(`必需检查不以 success 完成时拒绝发版：${conclusion}`, () => {
		assert.equal(
			evaluateCheckRuns({
				check_runs: [
					run(1, MAC, "completed", "success"),
					run(2, LINUX, "completed", conclusion),
					run(3, WINDOWS, "completed", "success"),
					run(4, WINDOWS_ARM, "completed", "success"),
				],
			}).state,
			"fail",
		);
	});
}

for (const windows of [WINDOWS, WINDOWS_ARM]) {
	for (const status of ["missing", "in_progress", "failure", "success"]) {
		test(`${windows} release gate: ${status}`, () => {
			const checks = REQUIRED_CHECKS.filter((name) => name !== windows).map((name, index) =>
				run(index + 1, name, "completed", "success"),
			);
			if (status !== "missing") checks.push(run(4, windows, status === "in_progress" ? status : "completed", status));
			assert.equal(
				evaluateCheckRuns({ check_runs: checks }).state,
				status === "success" ? "pass" : status === "failure" ? "fail" : "pending",
			);
		});
	}
}
