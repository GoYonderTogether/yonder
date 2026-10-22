import { type PluginAPI, parseRef } from "@yonder/sdk";

export type SendResult = "sent" | "failed" | "unknown";
type Messages = Pick<PluginAPI["messages"], "send">;

export async function sendProgress(messages: Messages, target: string, text: string): Promise<SendResult> {
	let parsed: ReturnType<typeof parseRef>;
	try {
		parsed = parseRef(target);
	} catch {
		return "failed";
	}
	if (parsed.kind !== "acct" && parsed.kind !== "conv") return "failed";

	try {
		const receipt: unknown = await messages.send({ to: target, text });
		if (typeof receipt !== "object" || receipt === null || !("ok" in receipt)) return "unknown";
		if ("uncertain" in receipt && receipt.uncertain === true) return "unknown";
		if (receipt.ok === true) return "sent";
		if (receipt.ok === false) return "failed";
		return "unknown";
	} catch {
		return "unknown";
	}
}
