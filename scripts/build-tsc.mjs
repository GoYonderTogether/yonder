import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { distDrift, owningProject } from "./check-dist-sync.mjs";

// dist 被 .gitignore 忽略，`tsc -b` 只按文件 mtime 判断工程是否最新：dist 被拷贝、回滚或部分恢复过
// （产物比源码新，但内容不是这次源码的产物）时它不会再产出，构建照常成功而运行时报错
// （BE-11：dist/tools/model-route.js 少了 modelChainRefs，dist/runtime/model-chain-config.js 照旧
// import，doctor 抛 SyntaxError）。所以这里在 tsc 之后核对产物与源码，只删掉不一致的工程再重建一次；
// 重建后仍不一致才失败——那是真的编译/配置问题，需要 build:clean 或人查。
const ROOT = resolve(import.meta.dirname, "..");
const TSC = resolve(ROOT, "node_modules/typescript/bin/tsc");

function tsc(projects = []) {
	const run = spawnSync(process.execPath, [TSC, "-b", ...projects], { cwd: ROOT, stdio: "inherit" });
	if (run.error) throw run.error;
	if (run.status !== 0) process.exit(run.status ?? 1);
}

function removeStale(problems) {
	const projects = [...new Set(problems.map((problem) => owningProject(problem)).filter(Boolean))].sort();
	console.log(`dist 与源码不一致（${problems.length} 处），删除 ${projects.length} 个工程的 dist 后重建一次：`);
	for (const project of projects) {
		console.log(`  ${project}/dist`);
		rmSync(resolve(ROOT, project, "dist"), { recursive: true, force: true });
	}
	return projects;
}

tsc();
let problems = distDrift();
if (problems.length) {
	removeStale(problems);
	tsc();
	problems = distDrift();
	if (problems.length) {
		console.error(`dist 与源码仍不一致（${problems.length} 处）：`);
		for (const problem of problems.slice(0, 20)) console.error(`  ${problem}`);
		console.error("\n修：npm run build:clean，或检查这些源码是否真的由对应的 tsconfig 产出。");
		process.exit(1);
	}
	console.log("已重建受影响工程，dist 与源码一致。");
}
