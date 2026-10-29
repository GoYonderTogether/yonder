import type { Hook, PluginAPI, ToolContext, YEvent } from "@yonder/sdk";
import type { Config } from "./moments.js";
import type { Store } from "./store/index.js";

async function humanMessages(api: PluginAPI, to: string): Promise<YEvent[]> {
	if (!to.startsWith("conv:") && !to.startsWith("acct:") && !to.startsWith("person:")) return [];
	const accounts = to.startsWith("person:") ? (await api.identity.lookup(to)).accounts.map((a) => a.ref) : [to];
	const events: YEvent[] = [];
	for (const account of accounts) {
		let after: string | undefined;
		do {
			const page = await api.events.query({
				type: "message.in",
				...(account.startsWith("conv:") ? { conv: account } : { from: account }),
				limit: 1000,
				...(after ? { after } : {}),
			});
			events.push(...page.events.filter((e) => e.from?.startsWith("acct:") || e.from?.startsWith("person:")));
			after = page.next;
		} while (after);
	}
	return events.sort((a, b) => a.ts.localeCompare(b.ts));
}
export function digest(api: PluginAPI, store: Store, config: Config, now = Date.now): Hook {
	return {
		id: "tasks-digest",
		async beforeSend(message, owner) {
			if (!owner || !message.text.trim() || config.tailDigest?.enabled === false) return;
			const human = await humanMessages(api, message.to);
			const latest = human.at(-1);
			if (!latest) return;
			const time = now();
			const previous = human.at(-2);
			const gap =
				time - Date.parse(latest.ts) > 2 * 3600000 ||
				(previous && Date.parse(latest.ts) - Date.parse(previous.ts) > 2 * 3600000);
			const replies = gap
				? await api.events.query({
						type: "message.out",
						...(latest.conv ? { conv: latest.conv } : {}),
						since: new Date(
							time - Date.parse(latest.ts) > 2 * 3600000 ? Date.parse(latest.ts) + 2 * 3600000 : Date.parse(latest.ts),
						).toISOString(),
						limit: 1000,
					})
				: undefined;
			const away =
				gap &&
				!replies?.events.some(
					(e) => e.from === `agent:${owner.agent}` && (e.data as { to?: string }).to === message.to,
				);
			const ctx = { ...owner, capabilities: [], signal: new AbortController().signal } as unknown as ToolContext;
			const tasks = store
				.list(ctx)
				.filter((t) =>
					owner.agent ? t.ownerAgent === owner.agent : t.ownerAgent === null && t.session === owner.session,
				);
			const priority = (state: string) =>
				state === "waiting-user" || state === "review" ? 0 : state === "blocked" ? 1 : 2;
			const candidates = tasks
				.filter((t) => t.state === "waiting-user" || t.state === "review" || t.state === "blocked" || t.lastDeliveryAt)
				.filter((t) => t.state !== "cancelled" && !store.digestSeen(t, message.to, time))
				.sort((a, b) => priority(a.state) - priority(b.state));
			const lines: string[] = [];
			const zh = api.locale.startsWith("zh");
			for (const task of candidates.slice(0, Math.min(5, config.tailDigest?.lines ?? 5))) {
				if (!store.claimDigest(task, message.to, time)) continue;
				const label =
					priority(task.state) === 0
						? zh
							? "等你"
							: "Waiting for you"
						: priority(task.state) === 1
							? zh
								? "卡住"
								: "Blocked"
							: zh
								? "已交付"
								: "Delivered";
				lines.push(
					`${away ? (zh ? "离开期间 · " : "While you were away · ") : ""}${label} ${task.ref} ${task.title.replace(/\s+/g, " ")}`,
				);
			}
			if (lines.length) return { message: { ...message, text: `${message.text}\n\n${lines.join("\n")}` } };
		},
	};
}
