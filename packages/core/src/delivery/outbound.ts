import type { Delivery, ExecutionOwner, NotificationIntent } from "@yonder/sdk";
import type { AgentConfig, YonderConfig } from "../config/index.js";
import type { Sessions } from "../sessions/index.js";
import type { Store } from "../store/index.js";
import type { createDelivery } from "./index.js";

type Intent = {
	owner: ExecutionOwner;
	plugin: string;
	text: string;
	notification: NotificationIntent;
	ownerRef?: string;
};

export function outboundQueue({
	store,
	sessions,
	agents,
	config,
	delivery,
}: {
	store: Store;
	sessions: Sessions;
	agents: Map<string, AgentConfig>;
	config: YonderConfig;
	delivery: () => ReturnType<typeof createDelivery>;
}) {
	let tail = Promise.resolve();
	let timer: ReturnType<typeof setInterval> | undefined;
	const serialized = <T>(fn: () => Promise<T>): Promise<T> => {
		const next = tail.then(fn);
		tail = next.then(
			() => {},
			() => {},
		);
		return next;
	};
	async function events(type: string) {
		const result = [];
		let after: string | undefined;
		do {
			const page = await store.events.query({ type, limit: 1000, ...(after ? { after } : {}) });
			result.push(...page.events);
			after = page.next;
		} while (after);
		return result;
	}
	async function enqueue(
		owner: ExecutionOwner,
		plugin: string,
		text: string,
		notification: NotificationIntent,
	): Promise<Delivery> {
		return serialized(async () => {
			const agent = owner.agent ? agents.get(owner.agent) : undefined;
			if (!agent?.social?.enabled || !agent.owner) return { ok: false, error: "Notification owner is unavailable" };
			if (
				!notification.key ||
				!notification.sourceEvents.length ||
				!(await Promise.all(notification.sourceEvents.map((id) => store.events.get(id)))).every(Boolean)
			)
				return { ok: false, error: "Invalid notification sources" };
			const previous = await events("notification.intent");
			if (
				previous.some((e) => {
					const i = e.data as Intent;
					return i.owner.agent === owner.agent && i.ownerRef === agent.owner && i.notification.key === notification.key;
				})
			)
				return { ok: true };
			await store.events.record({
				type: "notification.intent",
				from: `plugin:${plugin}`,
				data: { owner, plugin, text, notification, ownerRef: agent.owner },
			});
			return { ok: true };
		});
	}
	async function flush() {
		return serialized(async () => {
			const settings = config.notifications?.outbound;
			if (settings?.enabled === false || settings?.mode === "off") return;
			if (settings?.quiet) {
				const { timezone, start, end } = settings.quiet;
				const time = new Intl.DateTimeFormat("en-GB", {
					timeZone: timezone,
					hour: "2-digit",
					minute: "2-digit",
					hourCycle: "h23",
				}).format(new Date());
				if (start < end ? time >= start && time < end : time >= start || time < end) return;
			}
			const finals = await events("notification.final");
			const done = new Set(finals.flatMap((e) => (e.data as { intents: string[] }).intents));
			const pending = (await events("notification.intent")).filter((e) => !done.has(e.id));
			const groups = new Map<string, typeof pending>();
			for (const event of pending) {
				const intent = event.data as Intent;
				const key = `${intent.owner.agent}:${intent.ownerRef}`;
				groups.set(key, [...(groups.get(key) ?? []), event]);
			}
			for (const group of groups.values()) {
				const first = group[0]!;
				const intent = first.data as Intent;
				const last = finals
					.filter(
						(e) =>
							(e.data as { agent?: string; status?: string }).agent === intent.owner.agent &&
							(e.data as { status?: string }).status === "attempted",
					)
					.at(-1);
				if (
					settings?.mode !== "immediate" &&
					last &&
					Date.now() - Date.parse(last.ts) < (settings?.digestEverySeconds ?? 86400) * 1000
				)
					continue;
				if (
					settings?.mode !== "immediate" &&
					Date.now() - Date.parse(first.ts) < (settings?.digestEverySeconds ?? 86400) * 1000
				)
					continue;
				const agent = intent.owner.agent ? agents.get(intent.owner.agent) : undefined;
				const target = settings?.target;
				let targetAllowed = true;
				if (target && agent) {
					const social = agent.social;
					const person = target.to.startsWith("acct:")
						? (await store.identity().account(target.to))?.person
						: undefined;
					targetAllowed =
						![target.to, person, agent.owner].some((ref) => ref && social?.denied?.includes(ref)) &&
						(target.to.startsWith("acct:")
							? person === agent.owner ||
								!!social?.authorized?.accounts?.includes(target.to) ||
								!!(person && social?.authorized?.people?.includes(person))
							: !!social?.authorized?.conversations?.includes(target.to));
				}
				const active: typeof group = [];
				let sender:
					| {
							row: NonNullable<Awaited<ReturnType<typeof store.sessions.get>>>;
							resolved: Awaited<ReturnType<typeof sessions.resolveSession>>;
					  }
					| undefined;
				for (const event of group) {
					const item = event.data as Intent;
					const row = await store.sessions.get(item.owner.session);
					if (
						!agent?.social?.enabled ||
						agent.archivedAt ||
						agent.owner !== item.ownerRef ||
						!targetAllowed ||
						!row ||
						row.closed ||
						row.agent !== item.owner.agent ||
						row.profile !== item.owner.profile ||
						(item.notification.expiresAt && Date.parse(item.notification.expiresAt) <= Date.now())
					)
						continue;
					try {
						const resolved = await sessions.resolveSession(row.id);
						if (
							!resolved.resolved.capabilities.includes("message") ||
							(target && resolved.resolved.channelInstances && !resolved.resolved.channelInstances.includes(target.via))
						)
							continue;
						active.push(event);
						sender ??= { row, resolved };
					} catch {
						/* revoked */
					}
				}
				const selected = active.slice(0, settings?.maxItems ?? 5);
				const main =
					!target && intent.owner.agent
						? (await store.sessions.list({ agent: intent.owner.agent, mode: "main", open: true }))[0]
						: undefined;
				const discarded = group.filter((event) => !active.includes(event));
				if (discarded.length)
					await store.events.record({
						type: "notification.final",
						data: { intents: discarded.map((e) => e.id), status: "discarded" },
					});
				if (!sender || !selected.length || (!target && !main)) continue;
				const text = selected.map((e) => (e.data as Intent).text).join("\n");
				// A claimed send may be unknown after a crash; never automatically duplicate it.
				await store.events.record({
					type: "notification.final",
					data: { intents: selected.map((e) => e.id), agent: intent.owner.agent, status: "attempted" },
				});
				if (target) await delivery().sendOwned(intent.plugin, { ...target, text }, sender.resolved, sender.row);
				else if (main)
					await sessions.notifyFrom(main.id, { event: selected[0]!.id, text }, `agent:${intent.owner.agent}`);
			}
		});
	}
	return {
		enqueue,
		flush,
		start: () => {
			timer = setInterval(() => void flush().catch(() => {}), 60000);
			timer.unref();
			void flush().catch(() => {});
		},
		stop: async () => {
			if (timer) clearInterval(timer);
			await tail;
		},
	};
}
