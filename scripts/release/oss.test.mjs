import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
	authorization,
	canonicalizedOssHeaders,
	canonicalizedResource,
	contentMd5,
	httpDate,
	PUBLIC_BASE_URL,
	readCredentials,
	signatureV1,
	signedHeaders,
	stringToSign,
} from "./oss.mjs";

test("CanonicalizedOSSHeaders 只取 x-oss-*、小写、字典序、末尾换行", () => {
	assert.equal(canonicalizedOssHeaders({}), "");
	assert.equal(
		canonicalizedOssHeaders({
			"X-OSS-Meta-Author": "alice",
			"x-oss-meta-magic": "abracadabra",
			"Content-Type": "text/html",
		}),
		"x-oss-meta-author:alice\nx-oss-meta-magic:abracadabra\n",
	);
	// 冒号两侧空白去掉
	assert.equal(canonicalizedOssHeaders({ "x-oss-meta-author": "  alice  " }), "x-oss-meta-author:alice\n");
});

test("CanonicalizedResource 是 /bucket/object，空对象为 /bucket/", () => {
	assert.equal(canonicalizedResource("yonder-release", "android/latest.json"), "/yonder-release/android/latest.json");
	assert.equal(canonicalizedResource("yonder-release"), "/yonder-release/");
});

test("StringToSign 按 V1 的六段结构拼接", () => {
	const resource = canonicalizedResource("oss-example", "nelson");
	assert.equal(
		stringToSign({
			method: "put",
			contentMd5: "eB5eJF1ptWaXm4bijSPyxw==",
			contentType: "text/html",
			date: "Thu, 17 Nov 2005 18:49:58 GMT",
			ossHeaders: { "x-oss-meta-author": "foo@bar.com" },
			resource,
		}),
		"PUT\neB5eJF1ptWaXm4bijSPyxw==\ntext/html\nThu, 17 Nov 2005 18:49:58 GMT\nx-oss-meta-author:foo@bar.com\n/oss-example/nelson",
	);
	// 没有 x-oss-* 头时第四段后面直接接资源，不产生空行
	assert.equal(
		stringToSign({ method: "GET", date: "Thu, 17 Nov 2005 18:49:58 GMT", resource: "/oss-example/" }),
		"GET\n\n\nThu, 17 Nov 2005 18:49:58 GMT\n/oss-example/",
	);
});

test("Signature V1 是 HMAC-SHA1 的 base64", () => {
	// 阿里云文档 V1 示例的 StringToSign 与 AccessKeySecret（示例密钥，不是真实凭据）
	const toSign = [
		"PUT",
		"ODBGOERFMDMzQTczRUY3NUE3NzA5QzdFNUYzMDQxNEM=",
		"text/html",
		"Wed, 28 Dec 2022 10:27:41 GMT",
		"x-oss-meta-magic:abracadabra",
		"x-oss-meta-author:alice",
		"/oss-example/nelson",
	].join("\n");
	assert.equal(signatureV1("yourAccessKeySecret", toSign), "hLqW6n+vFupta5BtQRQaQL674x4=");
});

test("signedHeaders 覆盖 Date、Content-MD5、Content-Type 与 x-oss-*，并给出 Authorization", () => {
	const body = Buffer.from("hello");
	const headers = signedHeaders({
		method: "PUT",
		key: "android/latest.json",
		body,
		contentType: "application/json",
		ossHeaders: { "x-oss-object-acl": "public-read" },
		credentials: { accessKeyId: "id", accessKeySecret: "secret" },
		date: "Wed, 01 Nov 2026 00:00:00 GMT",
	});
	assert.equal(headers.Date, "Wed, 01 Nov 2026 00:00:00 GMT");
	assert.equal(headers["Content-Type"], "application/json");
	assert.equal(headers["Content-MD5"], createHash("md5").update(body).digest("base64"));
	assert.equal(headers["x-oss-object-acl"], "public-read");
	const expected = signatureV1(
		"secret",
		stringToSign({
			method: "PUT",
			contentMd5: contentMd5(body),
			contentType: "application/json",
			date: "Wed, 01 Nov 2026 00:00:00 GMT",
			ossHeaders: { "x-oss-object-acl": "public-read" },
			resource: "/yonder-release/android/latest.json",
		}),
	);
	assert.equal(headers.Authorization, authorization("id", expected));
	assert.match(headers.Authorization, /^OSS id:[A-Za-z0-9+/=]+$/);
	// 不带 body 的 GET 不写 Content-MD5
	const get = signedHeaders({
		method: "GET",
		key: "android/latest.json",
		credentials: { accessKeyId: "id", accessKeySecret: "secret" },
		date: "Wed, 01 Nov 2026 00:00:00 GMT",
	});
	assert.equal(get["Content-MD5"], undefined);
	assert.equal(get["Content-Type"], undefined);
});

test("httpDate 用 RFC 1123（UTC）", () => {
	assert.equal(httpDate(new Date("2026-11-01T00:00:00Z")), "Sun, 01 Nov 2026 00:00:00 GMT");
});

test("凭据缺失时报错，不用空串或默认值继续", () => {
	assert.deepEqual(
		readCredentials({ ALIBABA_CLOUD_ACCESS_KEY_ID: " id ", ALIBABA_CLOUD_ACCESS_KEY_SECRET: " secret " }),
		{ accessKeyId: "id", accessKeySecret: "secret" },
	);
	assert.throws(() => readCredentials({}), /ALIBABA_CLOUD_ACCESS_KEY_ID/);
	assert.throws(() => readCredentials({ ALIBABA_CLOUD_ACCESS_KEY_ID: "id" }), /ALIBABA_CLOUD_ACCESS_KEY_SECRET/);
	assert.throws(
		() => readCredentials({ ALIBABA_CLOUD_ACCESS_KEY_ID: " ", ALIBABA_CLOUD_ACCESS_KEY_SECRET: "s" }),
		/缺少/,
	);
});

test("公开读取地址是 bucket 的 cn-hangzhou 域名", () => {
	assert.equal(PUBLIC_BASE_URL, "https://yonder-release.oss-cn-hangzhou.aliyuncs.com");
});
