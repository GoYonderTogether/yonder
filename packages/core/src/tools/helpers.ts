import type { Tool, ToolContext, ToolResult } from "@yonder/sdk";
import { coreToolCapabilities } from "./catalog.js";

export const fail = (e: unknown): ToolResult => ({ text: e instanceof Error ? e.message : String(e), isError: true });
/** Capability metadata comes from the catalog; every failure becomes a tool result instead of a thrown call. */
export const tool = (definition: Omit<Tool, "capabilities">): Tool => ({
	capabilities: coreToolCapabilities[definition.name]!,
	...definition,
	execute: async (args, ctx) => {
		try {
			ctx.signal.throwIfAborted();
			return await definition.execute(args, ctx);
		} catch (error) {
			return fail(error);
		}
	},
});

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
