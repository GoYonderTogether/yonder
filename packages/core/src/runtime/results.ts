import type { ToolExecutionResult } from "@earendil-works/pi-durable";
import type { Attachment, ToolResult } from "@yonder/sdk";

export const toResult = (value: ToolResult): ToolExecutionResult => ({
	output: [
		{ type: "text", text: value.text },
		...(value.images ?? []).map((image) => ({ type: "image" as const, mimeType: image.mime, data: image.data })),
	],
	isError: value.isError ?? false,
	...(value.attachments?.length ? { details: { attachments: JSON.parse(JSON.stringify(value.attachments)) } } : {}),
});
export function fromResult(value: ToolExecutionResult): ToolResult {
	return {
		...((value.details as { attachments?: Attachment[] } | undefined)?.attachments
			? { attachments: (value.details as unknown as { attachments: Attachment[] }).attachments }
			: {}),
		text: (value.output ?? [])
			.filter((b) => b.type === "text")
			.map((b) => b.text)
			.join("\n"),
		images: (value.output ?? []).filter((b) => b.type === "image").map((b) => ({ mime: b.mimeType, data: b.data })),
		isError: value.isError ?? false,
	};
}

/** Missing task reports never become a claim of goal completion. */
export const taskReport = (text: string) =>
	!text.trim() || text.trim() === "NO_REPLY" ? "STATUS: unknown (no report)" : text;
