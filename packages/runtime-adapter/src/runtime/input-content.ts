import type { Context } from "@earendil-works/chord";
import { DEFAULT_IMAGE_LIMITS, type ImageProcessor } from "@earendil-works/pi-durable/tools";
import type { ExecutionEnv, Models } from "@yonder/sdk";
import { imageData } from "./output.js";
import type { RuntimeInput, RuntimeSessionConfig } from "./types.js";

export function imageMime(bytes: Uint8Array): string | undefined {
	const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
	if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return "image/png";
	if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
	if (/^GIF8[79]a/.test(ascii(0, 6))) return "image/gif";
	if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
	return undefined;
}

function decodeBase64(value: string): Uint8Array {
	return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

export async function inputContent(
	config: RuntimeSessionConfig,
	input: RuntimeInput,
	preparation: Context,
	remainingImages: number,
	remainingBytes: number,
	environment: (config: RuntimeSessionConfig) => ExecutionEnv,
	modelsFor: (config: RuntimeSessionConfig) => Promise<Models>,
	imageProcessor: () => Promise<ImageProcessor>,
	readAttachment: (uri: string, env: ExecutionEnv, context: Context) => Promise<Uint8Array>,
) {
	const env = environment(config);
	const content: Array<{ type: "text"; text: string } | { type: "image"; mimeType: string; data: string }> = [
		{ type: "text", text: input.text },
	];
	const slash = config.resolved.model.indexOf("/");
	const model = (await modelsFor(config)).getModel(
		config.resolved.model.slice(0, slash),
		config.resolved.model.slice(slash + 1),
	);
	let count = 0;
	const actual = new Map<string, { mime: string; bytes: number }>();
	for (const attachment of input.attachments ?? [])
		if (attachment.kind === "image") {
			const bytes = attachment.uri.startsWith("data:")
				? decodeBase64(imageData(attachment.uri))
				: await readAttachment(attachment.uri, env, preparation);
			const mime = imageMime(bytes);
			const resize = model?.inputLimits?.images?.resize;
			actual.set(attachment.uri, { mime: mime ?? attachment.mime, bytes: bytes.byteLength });
			const image =
				mime &&
				model?.input.includes("image") &&
				count < Math.min(remainingImages, model.inputLimits?.images?.maxPerMessage ?? Infinity)
					? await (await imageProcessor()).prepare(bytes, mime, {
							maxWidth: resize?.maxWidth ?? DEFAULT_IMAGE_LIMITS.maxWidth,
							maxHeight: resize?.maxHeight ?? DEFAULT_IMAGE_LIMITS.maxHeight,
							maxBytes: resize?.maxBytes ?? DEFAULT_IMAGE_LIMITS.maxBytes,
						})
					: undefined;
			preparation.abortSignal?.throwIfAborted();
			if (
				image &&
				new TextEncoder().encode(JSON.stringify(content)).byteLength + image.data.length + 128 <= remainingBytes
			) {
				content.push({ type: "image", mimeType: image.mimeType, data: image.data });
				count++;
			} else
				content.push({
					type: "text",
					text: `attachment: ${attachment.name ?? attachment.kind} ${attachment.uri} (${mime ?? attachment.mime}, ${bytes.byteLength} bytes); image could not be supplied within this model's input limits`,
				});
		}

	if (input.event) {
		const attachments = (input.event.data as { attachments?: import("@yonder/sdk").Attachment[] }).attachments ?? [];
		input.event = {
			...input.event,
			data: { ...input.event.data, attachments: attachments.map((item) => ({ ...item, ...actual.get(item.uri) })) },
		};
	}
	return content;
}
