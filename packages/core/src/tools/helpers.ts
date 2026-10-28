import type { ToolContext } from "@yonder/sdk";

export function requireCapability(ctx: ToolContext, capability: "admin" | "cross-agent" | "message" | "read") {
	if (!ctx.capabilities.includes(capability)) throw new Error(`需要 ${capability} 能力。`);
}
export async function withSignal<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
	signal.throwIfAborted();
	let aborted: (() => void) | undefined;
	const cancellation = new Promise<never>((_resolve, reject) => {
		aborted = () => reject(signal.reason ?? new Error("工具调用已中止。"));
		signal.addEventListener("abort", aborted, { once: true });
	});
	try {
		return await Promise.race([work, cancellation]);
	} finally {
		if (aborted) signal.removeEventListener("abort", aborted);
	}
}
