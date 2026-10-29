import assert from "node:assert/strict";
import { test } from "node:test";
import {
	applySection,
	extractSection,
	groupCommits,
	mergeDerived,
	parseUnreleased,
	renderSection,
} from "./changelog.mjs";

const CHANGELOG = [
	"# Changelog",
	"",
	"## [Unreleased]",
	"",
	"- 手写条目一",
	"",
	"### Added",
	"",
	"- 手写新增",
	"",
	"## [0.3.26102802] - 2026-10-28",
	"",
	"- 上一版",
	"",
].join("\n");

test("提交按 conventional 类型分组，非变更类型被跳过", () => {
	const groups = groupCommits([
		"feat(cli): 新增发版入口",
		"feat: 无 scope 的功能",
		"fix(core): 修一处崩溃",
		"perf(runtime): 快一点",
		"docs: 更新说明",
		"chore(release): 0.3.26102803",
		"Merge branch 'x'",
		"随手写的标题",
	]);
	assert.deepEqual(groups.Added, ["cli：新增发版入口", "无 scope 的功能"]);
	assert.deepEqual(groups.Fixed, ["core：修一处崩溃"]);
	assert.deepEqual(groups.Changed, ["runtime：快一点"]);
	assert.equal(groups.Removed, undefined);
});

test("手写内容按小节解析，无小节条目进 lead", () => {
	assert.deepEqual(parseUnreleased(CHANGELOG), { lead: ["手写条目一"], groups: { Added: ["手写新增"] } });
});

test("本次提交并入同名小节，手写条目在前", () => {
	const merged = mergeDerived(parseUnreleased(CHANGELOG), {
		Added: ["手写新增", "cli：新增发版入口"],
		Fixed: ["core：修一处崩溃"],
	});
	assert.deepEqual(merged, {
		lead: ["手写条目一"],
		groups: { Added: ["手写新增", "cli：新增发版入口"], Fixed: ["core：修一处崩溃"] },
	});
	const section = renderSection({ version: "0.3.26102901", date: "2026-10-29", ...merged });
	assert.equal(
		section,
		[
			"## [0.3.26102901] - 2026-10-29",
			"",
			"- 手写条目一",
			"",
			"### Added",
			"",
			"- 手写新增",
			"- cli：新增发版入口",
			"",
			"### Fixed",
			"",
			"- core：修一处崩溃",
		].join("\n"),
	);
});

test("新小节插在 Unreleased 之后，旧版本小节保持原样", () => {
	const section = renderSection({ version: "0.3.26102901", date: "2026-10-29", ...parseUnreleased(CHANGELOG) });
	const next = applySection(CHANGELOG, section);
	assert.match(next, /## \[Unreleased\]\n\n## \[0\.3\.26102901\]/);
	assert.match(next, /\n\n## \[0\.3\.26102802\] - 2026-10-28\n\n- 上一版/);
	assert.deepEqual(parseUnreleased(next), { lead: [], groups: {} });
	assert.equal(extractSection(next, "0.3.26102901").includes("### Added"), true);
	assert.equal(next.includes("- 上一版"), true);
});

test("缺少 Unreleased 小节时拒绝写入", () => {
	assert.throws(() => applySection("# Changelog\n", "## [0.3.1] - 2026-10-29"), /Unreleased/);
});

test("取出指定版本小节作为 Release 正文，找不到时返回 null", () => {
	assert.equal(extractSection(CHANGELOG, "0.3.26102802"), "- 上一版");
	assert.equal(extractSection(CHANGELOG, "0.3.26102799"), null);
});
