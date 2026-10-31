import { type Channel, parseRef } from "@yonder/sdk";
import { allowsChannelInstance, assertChannelInstance } from "../config/console.js";
import type { AgentConfig } from "../config/index.js";
import type { RuntimeSessionConfig } from "../runtime/index.js";
import type { Store } from "../store/index.js";
import { consoleAllowed, type Scope } from "./console.js";
import type { MessageRequest } from "./request.js";
import { channelId } from "./shared.js";

export function createTargetResolver({
	store,
	agents,
	channels,
}: {
	store: Store;
	agents: Map<string, AgentConfig>;
	channels: Map<string, Channel>;
}) {
	return async function resolveTarget(
		request: Pick<MessageRequest, "to" | "via">,
		agent?: string | null,
		config?: RuntimeSessionConfig,
		scope: Scope = config?.resolved ?? {},
	): Promise<{ target: string; channel: Channel }> {
		if (request.via) assertChannelInstance(scope, request.via);
		let target = request.to;
		if (target === "owner") {
			if (!agent) throw new Error("预设会话没有 owner；请指定明确目标。");
			const owner = config ? config.owner : agents.get(agent)?.owner;
			if (!owner) throw new Error(`Agent ${agent} 没有 owner`);
			target = owner;
		}
		let parsed = parseRef(target);
		if (parsed.kind === "person") {
			const person = await store.identity().person(target);
			const accounts = person ? await Promise.all(person.accounts.map((ref) => store.identity().account(ref))) : [];
			const selected = accounts
				.filter(
					(account) =>
						account &&
						consoleAllowed(account.ref, scope) &&
						allowsChannelInstance(scope, channelId(account.ref) ?? "") &&
						(!request.via || channelId(account.ref) === request.via),
				)
				.sort((a, b) => (b?.lastSeen ?? "").localeCompare(a?.lastSeen ?? ""))[0];
			if (!selected) throw new Error("此人没有符合渠道要求的账号；请先关联账号。");
			target = selected.ref;
			parsed = parseRef(target);
		}
		if (parsed.kind !== "acct" && parsed.kind !== "conv") throw new Error("目标必须为 person:、acct: 或 conv: 引用。");
		if (request.via && parsed.channel !== request.via) throw new Error("via 与目标引用的渠道不一致。");
		assertChannelInstance(scope, parsed.channel);
		const channel = channels.get(parsed.channel);
		if (!channel) throw new Error(`渠道未运行：${parsed.channel}`);
		return { target, channel };
	};
}
