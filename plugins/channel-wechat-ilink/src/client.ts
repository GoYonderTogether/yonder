// Migrated from AI-Being/plugins/wechat-ilink; protocol: Tencent/openclaw-weixin.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import type { Attachment } from "@yonder/sdk";

const VERSION = "1.0.0";
const CDN = "https://novac2c.cdn.weixin.qq.com/c2c";
const MAX_MEDIA = 100 * 1024 * 1024;
const API_TIMEOUT_MS = 35_000;
// Tencent documents getUpdates long polls of 35s; leave 10s for response delivery.
interface Media {
	encrypt_query_param?: string;
	aes_key?: string;
	full_url?: string;
}
interface Item {
	type?: number;
	text_item?: { text?: string };
	ref_msg?: { title?: string; svr_id?: string; message_item?: Item };
	image_item?: { media?: Media; aeskey?: string };
	voice_item?: { media?: Media; text?: string; encode_type?: number };
	file_item?: { media?: Media; file_name?: string };
	video_item?: { media?: Media };
}
function wav(pcm: Uint8Array): Buffer {
	const header = Buffer.alloc(44);
	header.write("RIFF");
	header.writeUInt32LE(pcm.byteLength + 36, 4);
	header.write("WAVEfmt ", 8);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(1, 22);
	header.writeUInt32LE(24000, 24);
	header.writeUInt32LE(48000, 28);
	header.writeUInt16LE(2, 32);
	header.writeUInt16LE(16, 34);
	header.write("data", 36);
	header.writeUInt32LE(pcm.byteLength, 40);
	return Buffer.concat([header, pcm]);
}
export function checkedServerBase(value: string, testBase?: string): string {
	const url = new URL(value);
	if (url.origin === testBase) return url.origin;
	const trustedHost = url.hostname === "weixin.qq.com" || url.hostname.endsWith(".weixin.qq.com");
	if (
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		url.port ||
		url.search ||
		url.hash ||
		url.pathname !== "/" ||
		!trustedHost
	) {
		throw new Error("wechat-ilink: untrusted API origin");
	}
	return url.origin;
}

export interface Message {
	message_id?: string;
	from_user_id?: string;
	to_user_id?: string;
	create_time_ms?: number;
	message_type?: number;
	context_token?: string;
	group_id?: string;
	item_list?: Item[];
}
export type { Item };

// Only these locally chosen labels and numeric codes may cross the diagnostic boundary.
export type IlinkStage =
	| "api-request"
	| "attachment-read"
	| "upload-url"
	| "cdn-upload"
	| "cdn-download"
	| "sendmessage";
type FailureReason = "transport" | "http" | "ret" | "invalid-response";
/** Safe-to-log fields of a failed request, plus whether the server ended the login session (-14). */
export function failureInfo(error: unknown): { diagnostic: object; expired: boolean; retry: boolean } {
	const known = error instanceof IlinkRequestError ? error : undefined;
	return {
		diagnostic: known?.diagnostic ?? {},
		expired: known?.errcode === -14 || known?.ret === -14,
		retry: known !== undefined && !known.rejected,
	};
}
/** Flattens an inbound message into text lines, downloaded media and the quoted message id. */
export async function messageContent(message: Message, download: (item: Item) => Promise<Attachment[]>) {
	const attachments: Attachment[] = [],
		text: string[] = [];
	let replyTo: string | undefined;
	for (const item of message.item_list ?? []) {
		if (item.type === 1) text.push(item.text_item?.text ?? "");
		if (item.type === 3 && item.voice_item?.text) text.push(`[微信附带转写，未经核对] ${item.voice_item.text}`);
		attachments.push(...(await download(item)));
		if (item.ref_msg) {
			replyTo ??= item.ref_msg.svr_id;
			text.push(
				`[引用 ${item.ref_msg.svr_id ?? ""}] ${item.ref_msg.title ?? ""} ${item.ref_msg.message_item?.text_item?.text ?? ""}`,
			);
			if (item.ref_msg.message_item) attachments.push(...(await download(item.ref_msg.message_item)));
		}
	}
	return { text, attachments, replyTo };
}
export class IlinkRequestError extends Error {
	readonly httpStatus: number | undefined;
	readonly ret: number | undefined;
	readonly errcode: number | undefined;
	constructor(
		readonly stage: IlinkStage,
		readonly reason: FailureReason,
		codes: { httpStatus?: unknown; ret?: unknown; errcode?: unknown } = {},
	) {
		const safeCode = (value: unknown): number | undefined =>
			typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
		const http = safeCode(codes.httpStatus);
		const httpStatus = http !== undefined && http >= 100 && http <= 599 ? http : undefined;
		const ret = safeCode(codes.ret),
			errcode = safeCode(codes.errcode);
		super(
			`wechat-ilink: request failed stage=${stage} reason=${reason}${httpStatus === undefined ? "" : ` http=${httpStatus}`}${ret === undefined ? "" : ` ret=${ret}`}${errcode === undefined ? "" : ` errcode=${errcode}`}`,
		);
		this.httpStatus = httpStatus;
		this.ret = ret;
		this.errcode = errcode;
	}
	get rejected(): boolean {
		return this.reason === "ret"
			? (this.ret !== undefined && this.ret !== 0) || (this.errcode !== undefined && this.errcode !== 0)
			: this.reason === "http" && this.httpStatus !== undefined && this.httpStatus >= 400 && this.httpStatus < 500;
	}
	get diagnostic() {
		return {
			stage: this.stage,
			reason: this.reason,
			...(this.httpStatus === undefined ? {} : { httpStatus: this.httpStatus }),
			...(this.ret === undefined ? {} : { ret: this.ret }),
			...(this.errcode === undefined ? {} : { errcode: this.errcode }),
		};
	}
}

export function createClient(options: {
	base: () => string;
	token: () => Promise<string | undefined>;
	signal: AbortSignal;
	saveMedia: (bytes: Uint8Array, name: string, mime: string) => Promise<Attachment>;
	fetch?: typeof fetch;
	testBaseUrl?: string;
}) {
	const request = async (
		endpoint: string,
		body?: unknown,
		authenticated = false,
		requestBase = options.base(),
		timeoutMs = API_TIMEOUT_MS,
		signal = options.signal,
	): Promise<Record<string, any>> => {
		const headers: Record<string, string> = { "iLink-App-Id": "bot", "iLink-App-ClientVersion": "65536" };
		if (body !== undefined) {
			headers["Content-Type"] = "application/json";
			headers.AuthorizationType = "ilink_bot_token";
			headers["X-WECHAT-UIN"] = Buffer.from(String(randomBytes(4).readUInt32BE())).toString("base64");
		}
		const path = endpoint.split("?")[0];
		const stage =
			path === "ilink/bot/getuploadurl"
				? "upload-url"
				: path === "ilink/bot/sendmessage"
					? "sendmessage"
					: "api-request";
		let httpStatus: number | undefined;
		try {
			if (authenticated) {
				const token = await options.token();
				if (!token) throw new Error("wechat-ilink: credential unavailable");
				headers.Authorization = `Bearer ${token}`;
			}
			const response = await (options.fetch ?? fetch)(new URL(endpoint, `${requestBase}/`), {
				method: body === undefined ? "GET" : "POST",
				headers,
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
				redirect: "error",
				signal: AbortSignal.any([options.signal, signal, AbortSignal.timeout(timeoutMs)]),
			});
			httpStatus = response.status;
			if (!response.ok) throw new IlinkRequestError(stage, "http", { httpStatus });
			// Node 24 JSON reviver source keeps uint64 identifiers exact without a custom parser.
			const result = JSON.parse(await response.text(), (key, value, source?: { source?: string }) =>
				["message_id", "msg_id", "svr_id"].includes(key) && typeof value === "number" ? source?.source : value,
			);
			if (!result || typeof result !== "object" || Array.isArray(result))
				throw new IlinkRequestError(stage, "invalid-response", { httpStatus });
			if (result.ret !== undefined && result.ret !== 0)
				throw new IlinkRequestError(stage, "ret", { httpStatus, ret: result.ret });
			if (result.errcode !== undefined && result.errcode !== 0)
				throw new IlinkRequestError(stage, "ret", { httpStatus, ret: result.ret, errcode: result.errcode });
			return result;
		} catch (error) {
			if (error instanceof IlinkRequestError) throw error;
			throw new IlinkRequestError(stage, "transport", { httpStatus });
		} // Never retain the original error, response body, request URL or credentials.
	};
	const baseInfo = { channel_version: VERSION, bot_agent: `Yonder/${VERSION}` };
	const mediaFetch = async (value: string, bytes?: Uint8Array, signal = options.signal): Promise<Response> => {
		const url = new URL(value);
		const test = options.testBaseUrl && url.origin === options.testBaseUrl;
		if (
			url.username ||
			url.password ||
			url.hash ||
			(!test && (url.protocol !== "https:" || !url.hostname.endsWith(".cdn.weixin.qq.com")))
		)
			throw new Error("wechat-ilink: untrusted CDN origin");
		const stage = bytes ? "cdn-upload" : "cdn-download";
		try {
			const result = await (options.fetch ?? fetch)(url, {
				method: bytes ? "POST" : "GET",
				redirect: "error",
				...(bytes ? { headers: { "Content-Type": "application/octet-stream" }, body: Buffer.from(bytes) } : {}),
				signal: AbortSignal.any([options.signal, signal, AbortSignal.timeout(60_000)]),
			});
			if (!result.ok) throw new IlinkRequestError(stage, "http", { httpStatus: result.status });
			return result;
		} catch (error) {
			if (error instanceof IlinkRequestError) throw error;
			throw new IlinkRequestError(stage, "transport");
		}
	};
	const download = async (item: Item): Promise<Attachment[]> => {
		const kind =
			item.type === 2
				? "image"
				: item.type === 3
					? "voice"
					: item.type === 4
						? "file"
						: item.type === 5
							? "video"
							: undefined;
		if (!kind) return [];
		const content =
			kind === "image"
				? item.image_item
				: kind === "voice"
					? item.voice_item
					: kind === "file"
						? item.file_item
						: item.video_item;
		const media = content?.media;
		if (kind === "voice" && !media && typeof item.voice_item?.text === "string" && item.voice_item.text.trim())
			return [];
		if (!media || (!media.full_url && !media.encrypt_query_param))
			throw new Error("wechat-ilink: media reference missing");
		const response = await mediaFetch(
			media.full_url ?? `${CDN}/download?encrypted_query_param=${encodeURIComponent(media.encrypt_query_param!)}`,
		);
		if (Number(response.headers.get("content-length") ?? 0) > MAX_MEDIA)
			throw new Error("wechat-ilink: media exceeds 100 MiB");
		const chunks: Uint8Array[] = [];
		let size = 0;
		if (!response.body) throw new Error("wechat-ilink: missing media bytes");
		for await (const chunk of response.body) {
			size += chunk.byteLength;
			if (size > MAX_MEDIA) {
				await response.body.cancel().catch(() => {});
				throw new Error("wechat-ilink: media exceeds 100 MiB");
			}
			chunks.push(chunk);
		}
		let bytes: Uint8Array = Buffer.concat(chunks);
		const hex = item.image_item?.aeskey;
		let key = hex ? Buffer.from(hex, "hex") : media.aes_key ? Buffer.from(media.aes_key, "base64") : undefined;
		if (key?.length === 32 && /^[0-9a-f]{32}$/i.test(key.toString())) key = Buffer.from(key.toString(), "hex");
		if (key) {
			if (key.length !== 16) throw new Error("wechat-ilink: invalid media key");
			try {
				const decipher = createDecipheriv("aes-128-ecb", key, null);
				bytes = Buffer.concat([decipher.update(bytes), decipher.final()]);
			} catch {
				throw new Error("wechat-ilink: media decryption failed");
			}
		} else if (kind !== "image") throw new Error("wechat-ilink: missing media key");
		const signature = Buffer.from(bytes.subarray(0, 12));
		const imageMime = signature.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
			? "image/png"
			: signature.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"))
				? "image/jpeg"
				: /^GIF8[79]a/.test(signature.toString("ascii"))
					? "image/gif"
					: signature.toString("ascii", 0, 4) === "RIFF" && signature.toString("ascii", 8, 12) === "WEBP"
						? "image/webp"
						: undefined;
		if (kind === "image" && !imageMime) throw new Error("wechat-ilink: unsupported image format");
		let mime =
			kind === "image"
				? imageMime!
				: kind === "video"
					? "video/mp4"
					: kind === "voice"
						? "audio/silk"
						: "application/octet-stream";
		let name =
			kind === "file"
				? (item.file_item?.file_name ?? "attachment.bin")
				: `${kind}.${kind === "image" ? "jpg" : kind === "video" ? "mp4" : "silk"}`;
		if (kind === "image") name = `image.${mime.split("/")[1] === "jpeg" ? "jpg" : mime.split("/")[1]}`;
		if (kind === "voice") {
			const encoding = item.voice_item?.encode_type;
			if (encoding === 4 || encoding === 6 || encoding === undefined) {
				const codec = await import("silk-wasm");
				if (codec.isSilk(bytes)) {
					try {
						bytes = wav((await codec.decode(bytes, 24000)).data);
						mime = "audio/wav";
						name = "voice.wav";
					} catch {
						mime = "audio/silk";
						name = "voice.silk";
					}
				} else if (Buffer.from(bytes.subarray(0, 4)).toString() === "OggS") {
					mime = "audio/ogg";
					name = "voice.ogg";
				} else {
					mime = encoding === 4 ? "audio/speex" : "audio/silk";
					name = encoding === 4 ? "voice.speex" : "voice.silk";
				}
			} else {
				const formats: Record<number, [string, string]> = {
					1: ["audio/wav", "wav"],
					5: ["audio/amr", "amr"],
					7: ["audio/mpeg", "mp3"],
					8: ["audio/ogg", "ogg"],
				};
				const format = formats[encoding];
				if (!format) throw new Error("wechat-ilink: unsupported voice codec");
				if (encoding === 1) bytes = wav(bytes);
				[mime, name] = [format[0], `voice.${format[1]}`];
			}
		}
		return [await options.saveMedia(bytes, name, mime)];
	};
	const upload = async (attachment: Attachment, peer: string, signal = options.signal): Promise<Item> => {
		if (!["image", "audio", "file", "video"].includes(attachment.kind))
			throw new Error("wechat-ilink: invalid attachment kind");
		if (!attachment.uri.startsWith("file:///")) throw new Error("wechat-ilink: local file URI required");
		const handle = await open(fileURLToPath(attachment.uri), constants.O_RDONLY | constants.O_NOFOLLOW);
		let bytes: Buffer;
		try {
			const info = await handle.stat();
			if (!info.isFile() || !info.size || info.size > MAX_MEDIA)
				throw new Error("wechat-ilink: invalid attachment size");
			bytes = Buffer.alloc(info.size + 1);
			let offset = 0;
			while (offset < bytes.length) {
				signal.throwIfAborted();
				const read = await handle.read(bytes, offset, bytes.length - offset, null);
				if (!read.bytesRead) break;
				offset += read.bytesRead;
			}
			bytes = bytes.subarray(0, offset);
			if (bytes.length !== info.size || bytes.length > MAX_MEDIA) throw new Error("wechat-ilink: attachment changed");
		} finally {
			await handle.close();
		}
		const key = randomBytes(16),
			filekey = randomBytes(16).toString("hex");
		const cipher = createCipheriv("aes-128-ecb", key, null),
			encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
		const mediaType = { image: 1, video: 2, file: 3, audio: 3 }[attachment.kind];
		const uploaded = await request(
			"ilink/bot/getuploadurl",
			{
				filekey,
				media_type: mediaType,
				to_user_id: peer,
				rawsize: bytes.byteLength,
				rawfilemd5: createHash("md5").update(bytes).digest("hex"),
				filesize: encrypted.length,
				no_need_thumb: true,
				aeskey: key.toString("hex"),
				base_info: baseInfo,
			},
			true,
			undefined,
			undefined,
			signal,
		);
		if (!uploaded.upload_full_url && !uploaded.upload_param)
			throw new IlinkRequestError("upload-url", "invalid-response");
		const target =
			uploaded.upload_full_url ??
			`${CDN}/upload?encrypted_query_param=${encodeURIComponent(uploaded.upload_param)}&filekey=${filekey}`;
		let response: Response;
		try {
			response = await mediaFetch(target, encrypted, signal);
		} catch (error) {
			if (error instanceof IlinkRequestError) throw error;
			throw new IlinkRequestError("cdn-upload", "invalid-response");
		}
		const parameter = response.headers.get("x-encrypted-param");
		if (!parameter) throw new IlinkRequestError("cdn-upload", "invalid-response", { httpStatus: response.status });
		const media = {
			encrypt_query_param: parameter,
			aes_key: Buffer.from(key.toString("hex")).toString("base64"),
			encrypt_type: 1,
		};
		if (attachment.kind === "image") return { type: 2, image_item: { media, mid_size: encrypted.length } } as Item;
		if (attachment.kind === "video") return { type: 5, video_item: { media, video_size: encrypted.length } } as Item;
		return {
			type: 4,
			file_item: {
				media,
				file_name: attachment.name ?? basename(fileURLToPath(attachment.uri)),
				len: String(bytes.byteLength),
			},
		} as Item;
	};

	return { request, download, upload, baseInfo };
}
