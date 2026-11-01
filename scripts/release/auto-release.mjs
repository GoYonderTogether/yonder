// Only dispatch the official release workflow for a verified, current main push.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseTaggedCommit, releaseOf } from "./version.mjs";

const SHA = /^[0-9a-f]{40}$/;
const CI_PATH = ".github/workflows/ci.yml";

/** Queue-time check: an automatic request must never fast-forward to an unverified tip. */
export function assertExpectedTarget(expected, mainSha) {
	if (!SHA.test(expected) || expected !== mainSha) {
		throw new Error("main 已变化或 expected_sha 不合法；等待当前 main 的 CI 后再发版");
	}
}

/** The event and a fresh API response must identify the same successful CI attempt. */
export function autoReleaseDecision({ event, run, workflow, repository, mainSha, taggedCommits = [] }) {
	const skip = (reason) => ({ eligible: false, reason });
	if (event?.action !== "completed") return skip("不是已完成的 CI 事件");
	if (!repository || workflow?.path !== CI_PATH || !Number.isSafeInteger(workflow.id)) {
		return skip("无法确认官方 CI 工作流");
	}
	const source = event.workflow_run;
	for (const candidate of [source, run]) {
		if (
			!candidate ||
			!Number.isSafeInteger(candidate.id) ||
			candidate.id <= 0 ||
			!Number.isSafeInteger(candidate.run_attempt) ||
			candidate.run_attempt <= 0 ||
			candidate.path !== CI_PATH ||
			candidate.workflow_id !== workflow.id ||
			candidate.status !== "completed" ||
			candidate.conclusion !== "success" ||
			candidate.event !== "push" ||
			candidate.head_branch !== "main" ||
			candidate.repository?.full_name !== repository ||
			candidate.head_repository?.full_name !== repository ||
			!SHA.test(candidate.head_sha)
		)
			return skip("仅接受本仓库 main push 的成功 CI");
	}
	if (source.id !== run.id || source.head_sha !== run.head_sha || source.run_attempt !== run.run_attempt) {
		return skip("CI 运行或重跑轮次已经变化");
	}
	if (mainSha !== run.head_sha) return skip("main 已前进，等待新提交的 CI");
	const released = releaseOf(run.head_sha, taggedCommits);
	if (released) return skip(`该提交已经发版：${released}`);
	return { eligible: true, sha: run.head_sha };
}

const exec = (program, args) =>
	execFileSync(program, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();

function main(args) {
	if (args[0] === "--assert-target") {
		assertExpectedTarget(args[1], args[2]);
		return;
	}
	if (process.env.GITHUB_EVENT_NAME !== "workflow_run") throw new Error("只接受 workflow_run 事件");
	const repository = process.env.GITHUB_REPOSITORY;
	if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? "")) throw new Error("缺少有效的 GITHUB_REPOSITORY");
	const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
	const runId = event.workflow_run?.id;
	if (!Number.isSafeInteger(runId) || runId <= 0) throw new Error("缺少有效的 CI run id");
	const api = (path) => JSON.parse(exec("gh", ["api", `repos/${repository}${path}`]));
	const run = api(`/actions/runs/${runId}`);
	const workflow = api("/actions/workflows/ci.yml");
	exec("git", ["fetch", "origin", "main", "--tags"]);
	const mainSha = exec("git", ["rev-parse", "origin/main"]);
	const taggedCommits = exec("git", ["log", "--no-walk", "--tags=v0.*", "--format=%H %P%x09%D%x09%s"])
		.split("\n")
		.filter(Boolean)
		.map(parseTaggedCommit);
	const decision = autoReleaseDecision({ event, run, workflow, repository, mainSha, taggedCommits });
	if (!decision.eligible) {
		console.log(`跳过自动发版：${decision.reason}`);
		return;
	}
	// No tag/version/Release writes here: release.yml owns every publishing side effect.
	exec("gh", [
		"workflow",
		"run",
		"release.yml",
		"--repo",
		repository,
		"--ref",
		"main",
		"-f",
		"ref=main",
		"-f",
		`expected_sha=${decision.sha}`,
		"-f",
		"require_ci=true",
	]);
	console.log(`已派发官方 release.yml：${decision.sha}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	try {
		main(process.argv.slice(2));
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
