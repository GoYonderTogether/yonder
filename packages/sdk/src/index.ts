import type { ChannelProvider, ContextContribution, Hook, PluginModule, Ref, Tool, Trigger } from "./types.js";

export type * from "./types.js";
export const definePlugin = <T extends PluginModule>(value: T): T => value;
export const defineChannel = <T extends ChannelProvider>(value: T): T => value;
export const defineTool = <T extends Tool>(value: T): T => value;
export const defineContext = <T extends ContextContribution>(value: T): T => value;
export const defineTrigger = <T extends Trigger>(value: T): T => value;
export const defineHook = <T extends Hook>(value: T): T => value;

export function parseRef(
	ref: string,
):
	| { kind: "acct" | "conv"; channel: string; id: string }
	| { kind: "person" | "agent" | "session" | "plugin"; id: string } {
	const match = /^(acct|conv):([a-z0-9-]+):(\S+)$/.exec(ref) as [string, "acct" | "conv", string, string] | null;
	if (match) return { kind: match[1], channel: match[2], id: match[3] };
	const simple = /^(person|agent|session|plugin):(\S+)$/.exec(ref) as
		| [string, "person" | "agent" | "session" | "plugin", string]
		| null;
	if (!simple || (simple[1] === "session" && !/^\d+$/.test(simple[2]))) throw new Error(`Invalid reference: ${ref}`);
	return { kind: simple[1], id: simple[2] };
}

function reference(ref: string): Ref {
	parseRef(ref);
	return ref;
}
export const acct = (channel: string, id: string): Ref => reference(`acct:${channel}:${id}`);
export const conv = (channel: string, id: string): Ref => reference(`conv:${channel}:${id}`);
export const person = (id: string): Ref => reference(`person:${id}`);
export const agent = (id: string): Ref => reference(`agent:${id}`);
export const session = (id: string | number): Ref => reference(`session:${id}`);
export const plugin = (id: string): Ref => reference(`plugin:${id}`);

export * from "./chat-commands.js";

/** Resource scope only; capabilities and source/ownership checks remain the caller's responsibility. */
export function allowsChannelInstance(scope: { channelInstances?: readonly string[] }, instance: string): boolean {
	return scope.channelInstances === undefined || scope.channelInstances.includes(instance);
}

export function assertChannelInstance(scope: { channelInstances?: readonly string[] }, instance: string): void {
	if (!allowsChannelInstance(scope, instance)) throw new Error(`Channel instance not authorized: ${instance}`);
}

/** Undefined is the intersection identity, while [] must never turn into unrestricted access. */
export function intersectChannelInstances(a?: readonly string[], b?: readonly string[]): string[] | undefined {
	if (a === undefined) return b === undefined ? undefined : [...b];
	return a.filter((instance) => b === undefined || b.includes(instance));
}

export { localIpcPath } from "./ipc.js";
export { privatePath, writePrivateFile } from "./private-path.js";
