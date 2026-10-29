import assert from "node:assert/strict";
import { test } from "node:test";
import {
	assertReleaseVersion,
	compareVersions,
	dateStamp,
	formatVersion,
	nextVersion,
	parseTaggedCommit,
	parseVersion,
	releasedTags,
	releaseOf,
} from "./version.mjs";

test("版本号解析与格式化互逆", () => {
	assert.deepEqual(parseVersion("0.3.26102802"), { minor: 3, date: "261028", sequence: 2 });
	assert.equal(formatVersion({ minor: 3, date: "261028", sequence: 2 }), "0.3.26102802");
	assert.equal(parseVersion("0.3.2610280"), null);
	assert.equal(parseVersion("v0.3.26102802"), null);
});

test("发布日按 UTC 计算，不随本机时区变化", () => {
	assert.equal(dateStamp(new Date("2026-10-29T04:47:31Z")), "261029");
	assert.equal(dateStamp(new Date("2026-01-02T00:00:00Z")), "260102");
});

test("当天序号在已有 tag 上递增", () => {
	const tags = ["v0.3.26102801", "v0.3.26102802", "v0.2.26102705", "v0.3.26102709"];
	assert.equal(nextVersion({ minor: 3, date: "261028", tags }), "0.3.26102803");
	assert.equal(nextVersion({ minor: 3, date: "261029", tags }), "0.3.26102901");
	assert.equal(nextVersion({ minor: 3, date: "261028", tags: [] }), "0.3.26102801");
});

test("序号用尽时报错", () => {
	assert.throws(() => nextVersion({ minor: 3, date: "261028", tags: ["v0.3.26102899"] }), /序号已用尽/);
});

test("版本比较按 minor 与日期序号", () => {
	assert.equal(compareVersions("0.3.26102901", "0.3.26102802"), 1);
	assert.equal(compareVersions("0.3.26102802", "0.3.26102802"), 0);
	assert.equal(compareVersions("0.3.26102801", "0.3.26102901"), -1);
	assert.equal(compareVersions("0.4.26102801", "0.3.26102999"), 1);
});

test("显式版本必须合法且高于已有 tag", () => {
	const tags = ["v0.3.26102802"];
	assert.equal(assertReleaseVersion("0.3.26102901", tags), "0.3.26102901");
	assert.throws(() => assertReleaseVersion("0.3.26102802", tags), /不高于已有 tag/);
	assert.throws(() => assertReleaseVersion("0.3.26102803-beta.1", tags), /格式/);
});

test("只有正式版 tag 参与重复发版判断", () => {
	assert.deepEqual(releasedTags(["v0.3.26102802", "nightly", "v0.3.26102803-beta.1"]), ["v0.3.26102802"]);
});

test("已发版判断覆盖 tag 所在提交与 CI 发版提交的父提交", () => {
	const commits = [
		parseTaggedCommit("aaa bbb\ttag: v0.3.26102901\tchore(release): 0.3.26102901"),
		parseTaggedCommit("ccc ddd\tHEAD -> main, tag: v0.3.26102802, origin/main\tRelease 0.3.26102802"),
		parseTaggedCommit("eee fff\ttag: nightly\tchore(release): nightly"),
	];
	assert.deepEqual(commits[1], {
		sha: "ccc",
		parents: ["ddd"],
		tags: ["v0.3.26102802"],
		subject: "Release 0.3.26102802",
	});
	assert.equal(releaseOf("aaa", commits), "v0.3.26102901");
	assert.equal(releaseOf("bbb", commits), "v0.3.26102901");
	assert.equal(releaseOf("ccc", commits), "v0.3.26102802");
	// 手工发版提交的父提交不算：那一版的内容不一定等于父提交
	assert.equal(releaseOf("ddd", commits), null);
	assert.equal(releaseOf("fff", commits), null);
});
