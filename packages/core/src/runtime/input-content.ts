import { fileURLToPath } from "node:url";
import type { Context } from "@earendil-works/chord";
import { getOrThrow } from "@earendil-works/pi-durable/env";
import { DEFAULT_IMAGE_LIMITS, type ImageProcessor } from "@earendil-works/pi-durable/tools";
import type { ExecutionEnv, Models } from "@yonder/sdk";
import { imageMime } from "./attachments.js";
import { imageData } from "./output.js";
import type { RuntimeInput, RuntimeSessionConfig } from "./types.js";

export async function inputContent(
	config: RuntimeSessionConfig,
	input: RuntimeInput,
	preparation: Context,
	remainingImages: number,
	remainingBytes: number,
	environment: (config: RuntimeSessionConfig) => ExecutionEnv,
	modelsFor: (config: RuntimeSessionConfig) => Promise<Models>,
	imageProcessor: () => Promise<ImageProcessor>,
) {
	const env = environment(config);
	const content: Array<{ type: "text"; text: string } | { type: "image"; mimeType: string; data: string }> = [
		{ type: "text", text: input.text },
	];
	const model = (await modelsFor(config)).getModel(
		config.resolved.model.slice(0, config.resolved.model.indexOf("/")),
		config.resolved.model.slice(config.resolved.model.indexOf("/") + 1),
	);
	let count = 0;
	const actual = new Map<string, { mime: string; bytes: number }>();
	for (const attachment of input.attachments ?? [])
		if (attachment.kind === "image") {
			const bytes = attachment.uri.startsWith("data:")
				? Buffer.from(imageData(attachment.uri), "base64")
				: getOrThrow(
						await env.readBinaryFile(
							attachment.uri.startsWith("file:") ? fileURLToPath(attachment.uri) : attachment.uri,
							preparation,
						),
					);
			const mime = imageMime(bytes),
				resize = model?.inputLimits?.images?.resize;
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
			if (image && Buffer.byteLength(JSON.stringify(content)) + Buffer.byteLength(image.data) + 128 <= remainingBytes) {
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
