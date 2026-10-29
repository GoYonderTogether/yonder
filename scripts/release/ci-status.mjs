// 发版前提：目标 commit 上的 check-runs 必须已经全绿（docs/spec/09 §5）。
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PASSING = new Set(["success", "neutral", "skipped"]);
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// ci.yml 的两个 job；发版 job 自己也会作为 check-run 挂在同一 commit 上，必须排除
export const REQUIRED_CHECKS = ["macOS typecheck, build, test, lint", "Linux typecheck, build, test, lint"];

/** check-runs 响应 → pass / pending / fail；同名检查只看最新一次。 */
export function evaluateCheckRuns(payload, required = REQUIRED_CHECKS) {
	const latest = new Map();
	for (const run of payload?.check_runs ?? []) {
		if (!required.includes(run.name)) continue;
		const known = latest.get(run.name);
		if (!known || (run.id ?? 0) > (known.id ?? 0)) latest.set(run.name, run);
	}
	const missing = required.filter((name) => !latest.has(name));
	if (missing.length > 0) return { state: "pending", message: `还没有检查：${missing.join(", ")}` };
	const runs = [...latest.values()];
	const running = runs.filter((run) => run.status !== "completed");
	if (running.length > 0) {
		const names = running.map((run) => `${run.name}=${run.status}`).join(", ");
		return { state: "pending", message: `还有未完成的检查：${names}` };
	}
	const failed = runs.filter((run) => !PASSING.has(run.conclusion));
	if (failed.length > 0) {
		const names = failed.map((run) => `${run.name}=${run.conclusion}`).join(", ");
		return { state: "fail", message: `检查未通过：${names}` };
	}
	return { state: "pass", message: `${runs.length} 项检查全部通过` };
}

function fetchCheckRuns(sha) {
	const output = execFileSync("gh", ["api", `repos/{owner}/{repo}/commits/${sha}/check-runs?per_page=100`], {
		encoding: "utf8",
	});
	return JSON.parse(output);
}

function main(argv) {
	const flag = (name) => {
		const index = argv.indexOf(name);
		return index === -1 ? undefined : (argv[index + 1] ?? "");
	};
	const sha = flag("--sha");
	if (!sha) {
		console.error("用法：ci-status.mjs --sha <commit> [--wait <秒>] [--interval <秒>]");
		return 2;
	}
	const wait = Number(flag("--wait") ?? 0);
	const interval = Number(flag("--interval") ?? 30);
	const deadline = Date.now() + wait * 1000;
	for (;;) {
		let result;
		try {
			result = evaluateCheckRuns(fetchCheckRuns(sha));
		} catch (error) {
			result = { state: "pending", message: `查询 check-runs 失败：${error.message}` };
		}
		console.log(`${result.state}: ${result.message}`);
		if (result.state === "pass") return 0;
		if (result.state === "fail") return 1;
		const remaining = (deadline - Date.now()) / 1000;
		if (remaining <= 0) return 1;
		sleep(Math.min(interval, remaining) * 1000);
	}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	process.exitCode = main(process.argv.slice(2));
}
