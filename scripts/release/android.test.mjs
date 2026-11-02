import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
	APK_OBJECT,
	androidVersionCode,
	assertNewerManifest,
	buildManifest,
	LATEST_OBJECT,
	publicUrl,
	readNotes,
	sha256,
	uploadAndroidRelease,
	versionedApkPath,
} from "./android.mjs";

const APK = Buffer.from("PK\u0003\u0004 fake apk bytes for tests");

test("versionCode = YYMMDDNN，和现有 26103020 同量纲", () => {
	assert.equal(androidVersionCode("0.3.26103020"), 26103020);
	assert.equal(androidVersionCode("0.3.26110205"), 26110205);
	assert.equal(androidVersionCode("0.4.27010101"), 27010101);
	// 同日序号递增
	assert.ok(androidVersionCode("0.3.26110206") > androidVersionCode("0.3.26110205"));
	// 次日递增
	assert.ok(androidVersionCode("0.3.26110301") > androidVersionCode("0.3.26110299"));
	// versionCode 不含 minor：同一天跨 minor 且当天序号相同时两者相等，由发布时的
	// assertNewerManifest 拦下，不会悄悄覆盖（见下一组用例）
	assert.equal(androidVersionCode("0.4.26110301"), androidVersionCode("0.3.26110301"));
});

test("versionCode 对非法版本报错，不用默认值", () => {
	assert.throws(() => androidVersionCode("0.3.0"), /0\.<minor>\.<YYMMDDNN>/);
	assert.throws(() => androidVersionCode("0.3.26110205-beta.1"), /0\.<minor>\.<YYMMDDNN>/);
	assert.throws(() => androidVersionCode("v0.3.26110205"), /0\.<minor>\.<YYMMDDNN>/);
});

test("对象键与公开地址", () => {
	assert.equal(versionedApkPath("0.3.26110205"), "android/yonder-0.3.26110205.apk");
	assert.equal(APK_OBJECT, "android/yonder-android.apk");
	assert.equal(LATEST_OBJECT, "android/latest.json");
	assert.equal(
		publicUrl(versionedApkPath("0.3.26110205")),
		"https://yonder-release.oss-cn-hangzhou.aliyuncs.com/android/yonder-0.3.26110205.apk",
	);
	assert.equal(publicUrl(LATEST_OBJECT), "https://yonder-release.oss-cn-hangzhou.aliyuncs.com/android/latest.json");
});

test("latest.json 带齐 version、versionCode、url、sha256、size", () => {
	const manifest = buildManifest({
		version: "0.3.26110205",
		apk: APK,
		notes: "修好了登录",
		publishedAt: "2026-11-02T00:00:00.000Z",
	});
	assert.deepEqual(manifest, {
		version: "0.3.26110205",
		versionCode: 26110205,
		// 阿里云不允许用 OSS 默认域名分发 APK；清单指向 GitHub Release 资产。
		url: "https://github.com/GoYonderTogether/yonder/releases/download/v0.3.26110205/yonder-android.apk",
		sha256: createHash("sha256").update(APK).digest("hex"),
		size: APK.length,
		notes: "修好了登录",
		publishedAt: "2026-11-02T00:00:00.000Z",
	});
	assert.equal(manifest.sha256, sha256(APK));
	// notes 与 publishedAt 可选；缺省时不写占位文本
	const bare = buildManifest({ version: "0.3.26110205", apk: APK });
	assert.equal("notes" in bare, false);
	assert.equal("publishedAt" in bare, false);
});

test("新清单的 versionCode 必须严格大于线上清单", () => {
	assert.doesNotThrow(() => assertNewerManifest({ versionCode: 26110205 }, null));
	assert.doesNotThrow(() => assertNewerManifest({ versionCode: 26110205 }, { versionCode: 26110204 }));
	assert.throws(() => assertNewerManifest({ versionCode: 26110205 }, { versionCode: 26110205 }), /不高于线上/);
	assert.throws(() => assertNewerManifest({ versionCode: 26110204 }, { versionCode: 26110205 }), /不高于线上/);
	assert.throws(() => assertNewerManifest({ versionCode: 26110205 }, { versionCode: "x" }), /不是数字/);
});

test("readNotes 不把空文件当说明", (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yonder-android-notes-"));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const file = path.join(dir, "notes.md");
	fs.writeFileSync(file, "  \n");
	assert.equal(readNotes(file), undefined);
	fs.writeFileSync(file, "修好了登录\n");
	assert.equal(readNotes(file), "修好了登录");
	assert.equal(readNotes(undefined), undefined);
});

test("dry-run 只打印清单，不发任何请求", async (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yonder-android-dry-"));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const apkPath = path.join(dir, "yonder-android.apk");
	fs.writeFileSync(apkPath, APK);
	const printed = [];
	const result = await uploadAndroidRelease({
		version: "0.3.26110205",
		apkPath,
		credentials: null,
		dryRun: true,
		log: (line) => printed.push(line),
	});
	assert.equal(result.uploaded, false);
	assert.equal(result.manifest.versionCode, 26110205);
	assert.equal(result.manifest.sha256, sha256(APK));
	assert.match(printed.join("\n"), /android\/latest\.json/);
});

test("上传顺序：先比对线上清单，再版本化 APK → 固定名 APK → latest.json", async (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yonder-android-upload-"));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const apkPath = path.join(dir, "yonder-android.apk");
	fs.writeFileSync(apkPath, APK);
	const calls = [];
	const transport = {
		async getObject({ key }) {
			calls.push(`GET ${key}`);
			return null;
		},
		async putObject({ key, body, contentType }) {
			calls.push(`PUT ${key} ${contentType} ${body.length}`);
		},
	};
	const result = await uploadAndroidRelease({
		version: "0.3.26110205",
		apkPath,
		notes: "说明",
		credentials: { accessKeyId: "id", accessKeySecret: "secret" },
		endpoint: "https://oss.example",
		bucket: "b",
		now: new Date("2026-11-02T00:00:00Z"),
		log: () => {},
		transport,
	});
	assert.equal(result.uploaded, true);
	assert.equal(calls.length, 4);
	assert.equal(calls[0], `GET ${LATEST_OBJECT}`);
	assert.match(calls[1], /^PUT android\/yonder-0\.3\.26110205\.apk application\/vnd\.android\.package-archive /);
	assert.match(calls[2], /^PUT android\/yonder-android\.apk /);
	assert.equal(
		calls[3],
		`PUT android/latest.json application/json; charset=utf-8 ${Buffer.byteLength(`${JSON.stringify(result.manifest, null, 2)}\n`)}`,
	);
});

test("线上清单更新时拒绝覆盖，且不发任何写请求", async (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yonder-android-stale-"));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const apkPath = path.join(dir, "yonder-android.apk");
	fs.writeFileSync(apkPath, APK);
	const writes = [];
	await assert.rejects(
		uploadAndroidRelease({
			version: "0.3.26110205",
			apkPath,
			credentials: { accessKeyId: "id", accessKeySecret: "secret" },
			log: () => {},
			transport: {
				async getObject() {
					return Buffer.from(JSON.stringify({ version: "0.3.26110301", versionCode: 26110301 }));
				},
				async putObject({ key }) {
					writes.push(key);
				},
			},
		}),
		/不高于线上/,
	);
	assert.deepEqual(writes, []);
});

test("线上 latest.json 不是合法 JSON 时拒绝覆盖", async (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yonder-android-corrupt-"));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const apkPath = path.join(dir, "yonder-android.apk");
	fs.writeFileSync(apkPath, APK);
	await assert.rejects(
		uploadAndroidRelease({
			version: "0.3.26110205",
			apkPath,
			credentials: { accessKeyId: "id", accessKeySecret: "secret" },
			log: () => {},
			transport: {
				async getObject() {
					return Buffer.from("<html>error</html>");
				},
				async putObject() {
					throw new Error("不应写入");
				},
			},
		}),
		/不是合法 JSON/,
	);
});
