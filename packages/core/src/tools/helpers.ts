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

export function requireCapability(
	ctx: ToolContext,
	capability: "admin" | "cross-agent" | "message" | "read",
	optionalParameters: string[] = [],
) {
	if (ctx.capabilities.includes(capability)) return;
	const detail = optionalParameters.length
		? ` 可选参数 ${optionalParameters.join(", ")} 需要此能力；当前 profile=${ctx.profile}，capabilities=${ctx.capabilities.join(", ") || "none"}。未创建委派。若不需要本次覆盖，省略这些参数即可使用已配置的默认值；若覆盖是任务要求，报告所缺能力，不要原样重试。`
		: "";
	throw new Error(`需要 ${capability} 能力。${detail}`);
}
/**
 * Real management CLI forms, in one place so tool error text cannot drift into commands that do not exist.
 * `--file` is required for validate; `inspect` is the top-level command, not an `agents` subcommand.
 */
export const managementCli = {
	show: (agent: string, home = "<active home>") => `yonder agents show ${agent} --home ${home}`,
	validate: (agent: string, home = "<active home>", file = "<json>") =>
		`yonder agents validate ${agent} --file ${file} --home ${home}`,
	inspect: (agent: string) => `yonder inspect --agent ${agent}`,
};

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
