// 阿里云 OSS 发布产物上传：用 node:crypto 手写 Signature V1，不引入 SDK（docs/spec/09 §6.3）。
// 凭据只从环境变量读取，缺失就报错退出，不写死、不落盘、不打印。
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { request } from "node:https";
import { fileURLToPath } from "node:url";

export const BUCKET = "yonder-release";
export const REGION_ENDPOINT = `https://${BUCKET}.oss-cn-hangzhou.aliyuncs.com`;

/** 发布产物的公开读取地址；清单与 APK 都由它拼出。 */
export const PUBLIC_BASE_URL = REGION_ENDPOINT;

/** RFC 1123 时间，OSS 的 Date 头只接受这一种格式。 */
export function httpDate(date = new Date()) {
	return date.toUTCString();
}

/** `x-oss-*` 头按名字字典序排列，名字小写、冒号后不留空格，整体以换行结尾。 */
export function canonicalizedOssHeaders(headers = {}) {
	const entries = Object.entries(headers)
		.map(([name, value]) => [name.toLowerCase(), String(value).trim()])
		.filter(([name]) => name.startsWith("x-oss-"))
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
	return entries.length === 0 ? "" : `${entries.map(([name, value]) => `${name}:${value}`).join("\n")}\n`;
}

/** `/bucket/object`；对象为空时按 OSS 规则是 `/bucket/`。 */
export function canonicalizedResource(bucket, key = "") {
	return `/${bucket}/${key}`;
}

/**
 * Signature V1 的 StringToSign：
 * `VERB\nContent-MD5\nContent-Type\nDate\nCanonicalizedOSSHeaders CanonicalizedResource`
 */
export function stringToSign({ method, contentMd5 = "", contentType = "", date, ossHeaders = {}, resource }) {
	const verb = String(method).toUpperCase();
	return [verb, contentMd5, contentType, date, `${canonicalizedOssHeaders(ossHeaders)}${resource}`].join("\n");
}

export function signatureV1(accessKeySecret, toSign) {
	return createHmac("sha1", accessKeySecret).update(toSign, "utf8").digest("base64");
}

export function contentMd5(body) {
	return createHash("md5").update(body).digest("base64");
}

export function authorization(accessKeyId, signature) {
	return `OSS ${accessKeyId}:${signature}`;
}

/** 凭据只认这两个环境变量；缺任何一个都直接失败，不用默认值或空串继续。 */
export function readCredentials(env = process.env) {
	const accessKeyId = env.ALIBABA_CLOUD_ACCESS_KEY_ID?.trim();
	const accessKeySecret = env.ALIBABA_CLOUD_ACCESS_KEY_SECRET?.trim();
	if (!accessKeyId || !accessKeySecret) {
		throw new Error("缺少 ALIBABA_CLOUD_ACCESS_KEY_ID / ALIBABA_CLOUD_ACCESS_KEY_SECRET；OSS 上传不提供默认凭据");
	}
	return { accessKeyId, accessKeySecret };
}

/** 一次 OSS 请求的完整签名头；纯函数，测试与请求共用同一份计算。 */
export function signedHeaders({ method, key, body, contentType, ossHeaders = {}, credentials, bucket = BUCKET, date }) {
	const headers = {
		Date: date ?? httpDate(),
		...(contentType ? { "Content-Type": contentType } : {}),
		...(body ? { "Content-MD5": contentMd5(body) } : {}),
		...ossHeaders,
	};
	const signature = signatureV1(
		credentials.accessKeySecret,
		stringToSign({
			method,
			contentMd5: headers["Content-MD5"] ?? "",
			contentType: headers["Content-Type"] ?? "",
			date: headers.Date,
			ossHeaders: headers,
			resource: canonicalizedResource(bucket, key),
		}),
	);
	return { ...headers, Authorization: authorization(credentials.accessKeyId, signature) };
}

function send({ method, url, headers, body }) {
	return new Promise((resolve, reject) => {
		const target = new URL(url);
		const req = request(
			{
				method,
				protocol: target.protocol,
				hostname: target.hostname,
				port: target.port || undefined,
				path: `${target.pathname}${target.search}`,
				headers,
			},
			(res) => {
				const chunks = [];
				res.on("data", (chunk) => chunks.push(chunk));
				res.on("end", () =>
					resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }),
				);
			},
		);
		req.on("error", reject);
		req.setTimeout(60_000, () => req.destroy(new Error(`${method} ${url} 超时`)));
		if (body) req.write(body);
		req.end();
	});
}

function objectUrl(key, endpoint) {
	return `${endpoint}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export async function putObject({
	key,
	body,
	contentType = "application/octet-stream",
	credentials,
	ossHeaders = {},
	bucket = BUCKET,
	endpoint = REGION_ENDPOINT,
}) {
	const headers = signedHeaders({ method: "PUT", key, body, contentType, ossHeaders, credentials, bucket });
	const response = await send({ method: "PUT", url: objectUrl(key, endpoint), headers, body });
	if (response.status !== 200) {
		throw new Error(`PUT ${key} 失败：HTTP ${response.status} ${response.body.toString("utf8").slice(0, 300)}`);
	}
	return response;
}

/** 读对象；不存在（404）返回 null，其它错误直接抛出并带上 OSS 的错误码。 */
export async function getObject({ key, credentials, bucket = BUCKET, endpoint = REGION_ENDPOINT }) {
	const headers = signedHeaders({ method: "GET", key, credentials, bucket });
	const response = await send({ method: "GET", url: objectUrl(key, endpoint), headers });
	if (response.status === 404) return null;
	if (response.status !== 200) {
		throw new Error(`GET ${key} 失败：HTTP ${response.status} ${response.body.toString("utf8").slice(0, 300)}`);
	}
	return response.body;
}

const CONTENT_TYPES = {
	".dmg": "application/x-apple-diskimage",
	".exe": "application/vnd.microsoft.portable-executable",
	".deb": "application/vnd.debian.binary-package",
	".appimage": "application/octet-stream",
	".apk": "application/vnd.android.package-archive",
};

/** 桌面与安卓安装包的内容类型；未知后缀按二进制流。 */
export function contentTypeFor(file) {
	const dot = file.lastIndexOf(".");
	return (dot >= 0 ? CONTENT_TYPES[file.slice(dot)] : undefined) ?? "application/octet-stream";
}

function main(argv) {
	const flag = (name) => {
		const index = argv.indexOf(name);
		return index === -1 ? undefined : (argv[index + 1] ?? "");
	};
	try {
		const credentials = readCredentials();
		const key = flag("--key");
		if (!key) throw new Error("--key 必填");
		if (argv.includes("--put")) {
			const file = flag("--file");
			if (!file) throw new Error("--put 需要 --file");
			const put = putObject({
				key,
				body: readFileSync(file),
				contentType: flag("--content-type") || contentTypeFor(file),
				credentials,
				ossHeaders: argv.includes("--public-read") ? { "x-oss-object-acl": "public-read" } : {},
			});
			return put.then(
				() => {
					console.log(`已上传 ${key}`);
					return 0;
				},
				(error) => {
					console.error(error.message);
					return 1;
				},
			);
		}
		if (argv.includes("--get")) {
			return getObject({ key, credentials }).then(
				(body) => {
					if (body === null) {
						console.error(`${key} 不存在`);
						return 1;
					}
					process.stdout.write(body);
					return 0;
				},
				(error) => {
					console.error(error.message);
					return 1;
				},
			);
		}
		console.error(
			"用法：oss.mjs --put --key <key> --file <path> [--content-type <type>] [--public-read] | --get --key <key>",
		);
		return 2;
	} catch (error) {
		console.error(error.message);
		return 1;
	}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	Promise.resolve(main(process.argv.slice(2))).then((code) => {
		process.exitCode = code;
	});
}
