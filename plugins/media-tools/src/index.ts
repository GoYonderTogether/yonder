import { randomUUID } from "node:crypto";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { definePlugin, type ToolContext, type ToolResult, type TSchema } from "@yonder/sdk";
import { Check } from "typebox/value";
import WebSocket from "ws";

class MediaError extends Error {}
const sizes = ["1024x1024", "960x1280", "768x1024", "720x1440", "720x1280"];
const parameters = {
	type: "object",
	properties: {
		prompt: { type: "string", minLength: 1, pattern: "\\S" },
		model: { type: "string", minLength: 1, pattern: "\\S" },
		image_size: { type: "string", enum: sizes },
	},
	required: ["prompt"],
	additionalProperties: false,
} as TSchema;
const fileContext = (signal: AbortSignal): Parameters<ToolContext["env"]["writeFile"]>[2] => ({
	abortSignal: signal,
	value: () => undefined,
	toString: () => "media-tools",
});
function httpUrl(value: unknown): URL {
	if (typeof value !== "string") throw new MediaError("INVALID_URL");
	const url = new URL(value);
	if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new MediaError("INVALID_URL");
	return url;
}
async function bytes(response: Response, limit: number): Promise<Buffer> {
	const reader = response.body?.getReader();
	if (!reader) throw new MediaError("EMPTY_RESPONSE");
	const chunks: Uint8Array[] = [];
	let length = 0;
	try {
		for (;;) {
			const chunk = await reader.read();
			if (chunk.done) break;
			length += chunk.value.byteLength;
			if (length > limit) throw new MediaError("RESPONSE_TOO_LARGE");
			chunks.push(chunk.value);
		}
	} finally {
		await reader.cancel();
	}
	if (!length) throw new MediaError("EMPTY_RESPONSE");
	return Buffer.concat(chunks);
}
function imageType(data: Buffer): { mime: string; extension: string } {
	if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
		return { mime: "image/png", extension: "png" };
	if (data[0] === 255 && data[1] === 216 && data[2] === 255) return { mime: "image/jpeg", extension: "jpg" };
	if (data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP")
		return { mime: "image/webp", extension: "webp" };
	throw new MediaError("INVALID_IMAGE");
}

function failure(error: unknown, signal: AbortSignal, stage: string, status?: number): ToolResult {
	// Only our own fixed diagnostics are safe to expose; supplier errors may contain secrets.
	const reason = signal.aborted ? "CANCELLED" : error instanceof MediaError ? error.message : "REQUEST_FAILED";
	return { text: `MEDIA_${reason}: stage=${stage}${status === undefined ? "" : ` HTTP=${status}`}`, isError: true };
}
const audioParameters = {
	type: "object",
	properties: {
		file: { type: "string", minLength: 1, pattern: "\\S" },
		model: { type: "string", minLength: 1, pattern: "\\S" },
	},
	required: ["file"],
	additionalProperties: false,
} as TSchema;
const speechParameters = {
	type: "object",
	properties: {
		text: { type: "string", minLength: 1, pattern: "\\S", maxLength: 2000 },
		model: { type: "string", minLength: 1, pattern: "\\S" },
		voice: { type: "string", minLength: 1, pattern: "\\S" },
		speed: { type: "number", minimum: 0.5, maximum: 2 },
	},
	required: ["text"],
	additionalProperties: false,
} as TSchema;
/** The protocol declares only "audio", so the container is decided by the bytes. */
function audioType(data: Buffer): { mime: string; extension: string } {
	if (data.subarray(0, 3).toString("latin1") === "ID3" || (data[0] === 255 && (data[1] ?? 0) >= 224))
		return { mime: "audio/mpeg", extension: "mp3" };
	if (data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WAVE")
		return { mime: "audio/wav", extension: "wav" };
	if (data.toString("ascii", 0, 4) === "OggS") return { mime: "audio/ogg", extension: "ogg" };
	throw new MediaError("INVALID_AUDIO");
}
/**
 * DashScope duplex TTS: run-task opens the task, continue-task carries the text, and the
 * synthesized audio arrives as binary frames. Server replies are matched by task_id, and a
 * task that never starts is a failure rather than an empty success.
 */
function dashscopeSpeech(
	base: URL,
	key: string,
	model: string,
	voice: string,
	text: string,
	speed: number | undefined,
	signal: AbortSignal,
	limit: number,
): Promise<Buffer> {
	const url = new URL(base.href);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	const socket = new WebSocket(url, { headers: { Authorization: `Bearer ${key}` }, handshakeTimeout: 15000 });
	const taskId = randomUUID().replaceAll("-", "");
	const chunks: Buffer[] = [];
	let total = 0;
	let started = false;
	let settled = false;
	return new Promise<Buffer>((settle, reject) => {
		const finish = (error?: MediaError) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal.removeEventListener("abort", abort);
			try {
				socket.close(1000);
			} catch {
				// A socket the peer already tore down needs no second close.
			}
			if (error) reject(error);
			else if (!started) reject(new MediaError("TTS_TASK_NOT_STARTED"));
			else if (!total) reject(new MediaError("EMPTY_RESPONSE"));
			else settle(Buffer.concat(chunks, total));
		};
		const abort = () => finish(new MediaError("CANCELLED"));
		const timer = setTimeout(() => finish(new MediaError("REQUEST_TIMEOUT")), 120000);
		timer.unref();
		if (signal.aborted) {
			finish(new MediaError("CANCELLED"));
			return;
		}
		signal.addEventListener("abort", abort, { once: true });
		const send = (action: string, payload: Record<string, unknown>) =>
			socket.send(JSON.stringify({ header: { action, task_id: taskId, streaming: "duplex" }, payload }));
		socket.on("open", () =>
			send("run-task", {
				task_group: "audio",
				task: "tts",
				function: "SpeechSynthesizer",
				model,
				parameters: {
					text_type: "PlainText",
					voice,
					format: "mp3",
					sample_rate: 24000,
					...(speed === undefined ? {} : { rate: speed }),
				},
				input: {},
			}),
		);
		socket.on("message", (data, isBinary) => {
			if (isBinary) {
				const frame = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
				total += frame.byteLength;
				if (total > limit) {
					finish(new MediaError("RESPONSE_TOO_LARGE"));
					return;
				}
				chunks.push(frame);
				return;
			}
			let event: { header?: { event?: string; task_id?: string } };
			try {
				event = JSON.parse(String(data));
			} catch {
				finish(new MediaError("INVALID_CAPABILITY_RESULT"));
				return;
			}
			if (event.header?.task_id !== taskId) return;
			if (event.header.event === "task-started") {
				started = true;
				send("continue-task", { input: { text } });
				send("finish-task", { input: {} });
				return;
			}
			if (event.header.event === "task-finished") {
				finish();
				return;
			}
			if (event.header.event === "task-failed") finish(new MediaError("TTS_TASK_FAILED"));
		});
		socket.on("error", () => finish(new MediaError("REQUEST_FAILED")));
		socket.on("close", () => finish());
	});
}
async function audioFile(file: string, ctx: ToolContext): Promise<{ data: Uint8Array; name: string }> {
	const context = fileContext(ctx.signal);
	const inputPath = file.startsWith("file:") ? fileURLToPath(file) : file;
	const target = await ctx.env.canonicalPath(inputPath, context);
	if (!target.ok) throw new MediaError("AUDIO_FILE_NOT_FOUND");
	if (!ctx.capabilities.includes("exec")) {
		const root = await ctx.env.canonicalPath(ctx.env.cwd, context);
		if (!root.ok) throw new MediaError("WORKSPACE_PATH_FAILED");
		const within = relative(root.value, target.value);
		if (isAbsolute(within) || within === ".." || within.startsWith("../")) {
			let allowed = false;
			for (const event of ctx.events ?? (ctx.event ? [ctx.event] : [])) {
				const attachments = (event.data as { attachments?: Array<{ uri: string }> }).attachments ?? [];
				for (const attachment of attachments) {
					const path = attachment.uri.startsWith("file:") ? fileURLToPath(attachment.uri) : attachment.uri;
					if (!isAbsolute(path)) continue;
					const canonical = await ctx.env.canonicalPath(path, context);
					if (canonical.ok && canonical.value === target.value) allowed = true;
				}
			}
			if (!allowed) throw new MediaError("AUDIO_OUTSIDE_WORKSPACE");
		}
	}
	const opened = await ctx.env.openBinaryReader(target.value, { noFollow: true }, context);
	if (!opened.ok) throw new MediaError("AUDIO_FILE_OPEN_FAILED");
	try {
		const info = await opened.value.info(context);
		if (!info.ok) throw new MediaError("AUDIO_FILE_INFO_FAILED");
		const limit = 50 * 1000 * 1000;
		if (info.value.size > limit) throw new MediaError("AUDIO_EXCEEDS_50MB");
		const content = await opened.value.read(0, limit + 1, context);
		if (!content.ok) throw new MediaError("AUDIO_FILE_READ_FAILED");
		if (!content.value.length) throw new MediaError("AUDIO_FILE_EMPTY");
		if (content.value.length > limit) throw new MediaError("AUDIO_EXCEEDS_50MB");
		return { data: content.value, name: basename(target.value) };
	} finally {
		await opened.value.close({ ...context, abortSignal: undefined });
	}
}

export default definePlugin({
	setup(api) {
		api.tools.register({
			name: `${api.id}_image_generate`,
			description:
				"Generate one image with the configured SiliconFlow image service and save it in workspace artifacts. Use for a requested illustration or visual asset, not as evidence of what a real person/place/product looks like. Returns a local image attachment; show the actual result through a supported channel, not just a description. No automatic retry. For SERVICE_NOT_CONFIGURED/API_KEY_MISSING/MODEL_NOT_CONFIGURED, inspect the image service configuration and credential reference; do not guess a model or request the secret in chat. Failure includes the stage: generation, download and save are different; a download/save failure may follow successful paid generation, so do not blindly regenerate.",
			parameters,
			capabilities: ["network", "write"],
			async execute(args, ctx): Promise<ToolResult> {
				let stage = "configuration";
				let status: number | undefined;
				try {
					if (!Check(parameters, args)) return { text: "MEDIA_INVALID_ARGUMENTS", isError: true };
					ctx.signal.throwIfAborted();
					const input = args as { prompt: string; model?: string; image_size?: string };
					const endpoint = await api.services.resolve("image");
					if (!endpoint) return { text: "MEDIA_IMAGE_SERVICE_NOT_CONFIGURED", isError: true };
					if (endpoint.protocol !== "siliconflow")
						return { text: "MEDIA_UNSUPPORTED_PROTOCOL: expected siliconflow", isError: true };
					if (!endpoint.apiKey) return { text: "MEDIA_API_KEY_MISSING", isError: true };
					const model = input.model ?? endpoint.models[0];
					if (!model || !endpoint.models.includes(model)) return { text: "MEDIA_MODEL_NOT_CONFIGURED", isError: true };
					const base = httpUrl(endpoint.baseUrl);
					base.pathname = `${base.pathname.replace(/\/$/, "")}/images/generations`;
					base.search = "";
					base.hash = "";
					const signal = ctx.signal;
					stage = "generation";
					const response = await fetch(base, {
						method: "POST",
						headers: { Authorization: `Bearer ${endpoint.apiKey}`, "Content-Type": "application/json" },
						body: JSON.stringify({ model, prompt: input.prompt, image_size: input.image_size ?? "1024x1024" }),
						signal,
						redirect: "error",
					});
					status = response.status;
					if (!response.ok) {
						await response.body?.cancel();
						throw new MediaError("HTTP_ERROR");
					}
					const payload = JSON.parse((await bytes(response, 1024 * 1024)).toString("utf8")) as {
						images?: Array<{ url?: unknown }>;
					};
					const url = httpUrl(payload.images?.[0]?.url);
					stage = "download";
					status = undefined;
					// Download URLs are temporary; never forward service Authorization to storage.
					const download = await fetch(url, { signal, redirect: "follow" });
					status = download.status;
					if (!download.ok) {
						await download.body?.cancel();
						throw new MediaError("HTTP_ERROR");
					}
					const data = await bytes(download, 20 * 1024 * 1024);
					const format = imageType(data);
					stage = "save";
					status = undefined;
					const context = fileContext(signal);
					const directory = resolve(ctx.env.cwd, "artifacts");
					const created = await ctx.env.createDir(directory, { recursive: true }, context);
					if (!created.ok) throw new MediaError("ARTIFACT_DIRECTORY_FAILED");
					const root = await ctx.env.canonicalPath(ctx.env.cwd, context);
					const target = await ctx.env.canonicalPath(directory, context);
					if (!root.ok || !target.ok) throw new MediaError("ARTIFACT_PATH_FAILED");
					const within = relative(root.value, target.value);
					if (within === ".." || within.startsWith("../") || isAbsolute(within))
						throw new MediaError("ARTIFACT_OUTSIDE_WORKSPACE");
					const name = `image-${randomUUID()}.${format.extension}`;
					const path = resolve(target.value, name);
					const saved = await ctx.env.writeFile(path, data, context);
					if (!saved.ok) throw new MediaError("ARTIFACT_WRITE_FAILED");
					const attachment = {
						kind: "image" as const,
						mime: format.mime,
						uri: pathToFileURL(path).href,
						name,
						bytes: data.length,
					};
					return { text: JSON.stringify({ service: endpoint.id, model, attachment }), attachments: [attachment] };
				} catch (error) {
					return failure(error, ctx.signal, stage, status);
				}
			},
		});

		api.tools.register({
			name: `${api.id}_audio_transcribe`,
			description:
				"Transcribe an audio file using the configured SiliconFlow ASR service. Without exec, reads only workspace files or explicit current input attachments. Platform limit: 50 MB and one hour. Returns transcription text.",
			parameters: audioParameters,
			capabilities: ["read", "network"],
			async execute(args, ctx): Promise<ToolResult> {
				let stage = "configuration";
				let status: number | undefined;
				try {
					if (!Check(audioParameters, args)) return { text: "MEDIA_INVALID_ARGUMENTS", isError: true };
					ctx.signal.throwIfAborted();
					const input = args as { file: string; model?: string };
					const endpoint = await api.services.resolve("asr");
					if (!endpoint) return { text: "MEDIA_ASR_SERVICE_NOT_CONFIGURED", isError: true };
					if (endpoint.protocol !== "siliconflow")
						return { text: "MEDIA_UNSUPPORTED_PROTOCOL: expected siliconflow", isError: true };
					if (!endpoint.apiKey) return { text: "MEDIA_API_KEY_MISSING", isError: true };
					const model = input.model ?? endpoint.models[0];
					if (!model || !endpoint.models.includes(model)) return { text: "MEDIA_MODEL_NOT_CONFIGURED", isError: true };
					stage = "read";
					const audio = await audioFile(input.file, ctx);
					const form = new FormData();
					form.set("model", model);
					form.set("file", new Blob([new Uint8Array(audio.data)], { type: "application/octet-stream" }), audio.name);
					const base = httpUrl(endpoint.baseUrl);
					base.pathname = `${base.pathname.replace(/\/$/, "")}/audio/transcriptions`;
					base.search = "";
					base.hash = "";
					stage = "transcription";
					const response = await fetch(base, {
						method: "POST",
						headers: { Authorization: `Bearer ${endpoint.apiKey}` },
						body: form,
						signal: ctx.signal,
						redirect: "error",
					});
					status = response.status;
					if (!response.ok) {
						await response.body?.cancel();
						throw new MediaError("HTTP_ERROR");
					}
					const payload = JSON.parse((await bytes(response, 1024 * 1024)).toString("utf8")) as { text?: unknown };
					if (typeof payload.text !== "string") throw new MediaError("INVALID_TRANSCRIPTION_RESPONSE");
					return { text: JSON.stringify({ service: endpoint.id, model, text: payload.text }) };
				} catch (error) {
					return failure(error, ctx.signal, stage, status);
				}
			},
		});

		api.tools.register({
			name: `${api.id}_audio_speak`,
			description:
				"Synthesize speech from text with the configured TTS service and save it in workspace artifacts. Use for a reply that should be heard rather than read. Returns a local audio attachment; show the actual result through a supported channel, not just a description. No automatic retry. For SERVICE_NOT_CONFIGURED/API_KEY_MISSING/MODEL_NOT_CONFIGURED/VOICE_NOT_CONFIGURED inspect the tts service configuration and credential reference; do not guess a model or voice or request the secret in chat. Failure includes the stage: synthesis and save are different, so a save failure may follow a successful paid synthesis and must not be blindly retried. The request is billed per character by the provider.",
			parameters: speechParameters,
			capabilities: ["network", "write"],
			async execute(args, ctx): Promise<ToolResult> {
				let stage = "configuration";
				try {
					if (!Check(speechParameters, args)) return { text: "MEDIA_INVALID_ARGUMENTS", isError: true };
					ctx.signal.throwIfAborted();
					const input = args as { text: string; model?: string; voice?: string; speed?: number };
					const endpoint = await api.services.resolve("tts");
					if (!endpoint) return { text: "MEDIA_TTS_SERVICE_NOT_CONFIGURED", isError: true };
					if (endpoint.protocol !== "dashscope")
						return { text: "MEDIA_UNSUPPORTED_PROTOCOL: expected dashscope", isError: true };
					if (!endpoint.apiKey) return { text: "MEDIA_API_KEY_MISSING", isError: true };
					const model = input.model ?? endpoint.models[0];
					if (!model || !endpoint.models.includes(model)) return { text: "MEDIA_MODEL_NOT_CONFIGURED", isError: true };
					const voice = input.voice ?? endpoint.voices?.[0];
					if (!voice || !endpoint.voices?.includes(voice)) return { text: "MEDIA_VOICE_NOT_CONFIGURED", isError: true };
					stage = "synthesis";
					// Two thousand characters of Chinese speech stays well under 20 MiB of MP3.
					const data = await dashscopeSpeech(
						httpUrl(endpoint.baseUrl),
						endpoint.apiKey,
						model,
						voice,
						input.text,
						input.speed,
						ctx.signal,
						20 * 1024 * 1024,
					);
					const format = audioType(data);
					stage = "save";
					const context = fileContext(ctx.signal);
					const directory = resolve(ctx.env.cwd, "artifacts");
					const created = await ctx.env.createDir(directory, { recursive: true }, context);
					if (!created.ok) throw new MediaError("ARTIFACT_DIRECTORY_FAILED");
					const root = await ctx.env.canonicalPath(ctx.env.cwd, context);
					const target = await ctx.env.canonicalPath(directory, context);
					if (!root.ok || !target.ok) throw new MediaError("ARTIFACT_PATH_FAILED");
					const within = relative(root.value, target.value);
					if (within === ".." || within.startsWith("../") || isAbsolute(within))
						throw new MediaError("ARTIFACT_OUTSIDE_WORKSPACE");
					const name = `speech-${randomUUID()}.${format.extension}`;
					const path = resolve(target.value, name);
					const saved = await ctx.env.writeFile(path, data, context);
					if (!saved.ok) throw new MediaError("ARTIFACT_WRITE_FAILED");
					const attachment = {
						kind: "audio" as const,
						mime: format.mime,
						uri: pathToFileURL(path).href,
						name,
						bytes: data.length,
					};
					return {
						text: JSON.stringify({ service: endpoint.id, model, voice, attachment }),
						attachments: [attachment],
					};
				} catch (error) {
					return failure(error, ctx.signal, stage);
				}
			},
		});
	},
});
