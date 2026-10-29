import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateCheckRuns, REQUIRED_CHECKS } from "./ci-status.mjs";

const [MAC, LINUX] = REQUIRED_CHECKS;
const run = (id, name, status, conclusion = null) => ({ id, name, status, conclusion });

test("ci.yml 两个 job 都通过时放行，发版 job 自己不影响结果", () => {
	const result = evaluateCheckRuns({
		check_runs: [
			run(1, MAC, "completed", "success"),
			run(2, LINUX, "completed", "success"),
			run(3, "Tag, CHANGELOG and GitHub Release", "in_progress"),
		],
	});
	assert.equal(result.state, "pass");
});

test("还有未完成的检查时继续等待", () => {
	const result = evaluateCheckRuns({ check_runs: [run(1, MAC, "completed", "success"), run(2, LINUX, "in_progress")] });
	assert.equal(result.state, "pending");
	assert.match(result.message, /Linux typecheck, build, test, lint=in_progress/);
});

test("缺少某个必需检查时视为未就绪", () => {
	assert.equal(evaluateCheckRuns({ check_runs: [run(1, MAC, "completed", "success")] }).state, "pending");
	assert.equal(evaluateCheckRuns({}).state, "pending");
});

test("任一检查失败即失败", () => {
	const result = evaluateCheckRuns({
		check_runs: [run(1, MAC, "completed", "failure"), run(2, LINUX, "completed", "success")],
	});
	assert.equal(result.state, "fail");
	assert.match(result.message, /macOS typecheck, build, test, lint=failure/);
});

test("同名检查重跑后以最新一次为准", () => {
	const result = evaluateCheckRuns({
		check_runs: [
			run(5, MAC, "completed", "success"),
			run(1, MAC, "completed", "failure"),
			run(2, LINUX, "completed", "skipped"),
		],
	});
	assert.equal(result.state, "pass");
});
