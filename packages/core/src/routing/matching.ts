import type { YEvent } from "@yonder/sdk";
import type { AgentConfig, Binding } from "../config/index.js";
import type { Store } from "../store/index.js";

const asArray = (value: string | string[] | undefined) =>
	value === undefined ? undefined : Array.isArray(value) ? value : [value];
export const channelOf = (ref?: string) => (ref?.startsWith("conv:") ? ref.split(":", 3)[1] : undefined);
const typeMatches = (pattern: string, type: string) =>
	pattern.endsWith(".*") ? type.startsWith(pattern.slice(0, -1)) : pattern === type;

export async function matches(binding: Binding, event: YEvent, agent: AgentConfig, store: Store): Promise<boolean> {
	const match = binding.match;
	if (!typeMatches(match.type ?? "message.in", event.type)) return false;
	if (match.conv && !asArray(match.conv)!.includes(event.conv ?? "")) return false;
	const channel = channelOf(event.conv);
	if (match.channel && !asArray(match.channel)!.includes(channel ?? "")) return false;
	const data = event.data as { kind?: unknown; mentioned?: unknown; target?: unknown };
	if (match.kind && (event.type !== "message.in" || !asArray(match.kind)!.includes(String(data.kind ?? ""))))
		return false;
	if (match.from) {
		if (!event.from?.startsWith("acct:")) return false;
		const expected = asArray(match.from)!;
		const account = await store.identity().account(event.from);
		const relation = !account?.person ? "stranger" : account.person === agent.owner ? "owner" : "known";
		for (const value of expected) {
			if (
				value === relation &&
				!(agent.social?.enabled && value === "owner" && event.type === "message.in" && data.kind !== "dm")
			)
				return true;
			if (value.startsWith("acct:") && value === event.from) return true;
			if (value.startsWith("person:") && account?.person === value) return true;
		}
		return false;
	}
	return true;
}
/**
 * 内置点名入口的绑定 id：不是配置里的绑定，所以配置校验把它当作保留 id。
 * 与 kernel/console.ts 的 `@console` 同一思路——零配置入口由内核合成，用户改不了也删不掉。
 */
export const TARGET_BINDING = "@target";

/**
 * 零配置点名入口：multiAgent 渠道（card、console）里主人私聊点名某个 Agent 时，
 * 该 Agent 即使没为这个渠道写绑定，也用自己的 main 会话接住这条消息。
 * spec 16 §2 要求「点名目标仍须命中它自己的绑定」，合成的绑定正属于目标 Agent 自身，
 * 因此既满足这条约束，也不需要给现有配置做迁移。
 */
export function targetBinding(
	agent: AgentConfig,
	event: YEvent,
	instance: string | undefined,
	fromOwner: boolean,
): Binding | undefined {
	if (event.type !== "message.in" || !instance || instance === "agent" || !fromOwner) return undefined;
	if ((event.data as { kind?: unknown }).kind !== "dm") return undefined;
	const main = agent.bindings.find((binding) => binding.session === "main" && binding.wake !== "write");
	if (!main) return undefined;
	return {
		id: TARGET_BINDING,
		match: { channel: instance, kind: "dm", from: "owner" },
		session: "main",
		profile: main.profile ?? agent.defaultProfile,
	};
}

export function sessionKey(
	binding: Binding,
	event: YEvent,
	accountPerson?: string,
): { mode: "main" | "persistent" | "ephemeral"; key: string } {
	if (binding.session === "main") return { mode: "main", key: "main" };
	if (binding.session === "ephemeral") return { mode: "ephemeral", key: event.id };
	if (binding.session.per === "conv") {
		if (!event.conv) throw new Error("Persistent conv session requires event.conv");
		return { mode: "persistent", key: `conv:${event.conv}` };
	}
	if (!event.from) throw new Error(`Persistent ${binding.session.per} session requires event.from`);
	if (binding.session.per === "from") return { mode: "persistent", key: `from:${event.from}` };
	return accountPerson
		? { mode: "persistent", key: `person:${accountPerson}` }
		: { mode: "persistent", key: `from:${event.from}` };
}
