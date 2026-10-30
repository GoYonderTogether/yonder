import { type HostCtx, MethodError, registry } from "@yonder/core";
import type { WorkControl } from "@yonder/sdk";
import { mapEvent } from "./events.js";
import { sessionSnapshot } from "./snapshot.js";

/** The trusted Card bridge uses the same registry and snapshots as the local gateway. */
export function workControl(host: Omit<HostCtx, "principal">, instance: string): WorkControl {
	const ctx: HostCtx = {
		...host,
		principal: { id: `card:${instance}`, transport: "gateway", kind: "remote", scopes: ["read", "write", "owner"] },
	};
	return {
		ready: async () => true,
		async request(_owner, method, params, signal) {
			const def = await registry.prepareCall(method, params ?? {}, ctx);
			if (def.stream) throw new MethodError("invalid_params", "stream requires subscription");
			return registry.call(method, params, ctx, signal);
		},
		async open(_owner, send, signal) {
			const subs = new Map<string, AbortController>();
			signal.addEventListener(
				"abort",
				() => {
					for (const sub of subs.values()) sub.abort();
					subs.clear();
				},
				{ once: true },
			);
			return {
				frame(value) {
					if (signal.aborted || !value || typeof value !== "object") return;
					const f = value as { t?: string; sub?: string; method?: string; params?: unknown; n?: number };
					if (f.t === "ping") {
						send({ t: "pong", ...(f.n === undefined ? {} : { n: f.n }) });
						return;
					}
					if (typeof f.sub !== "string" || !f.sub) return;
					const sub = f.sub;
					if (f.t === "unsub") {
						subs.get(sub)?.abort();
						subs.delete(sub);
						send({ t: "end", sub, reason: "unsub" });
						return;
					}
					if (f.t !== "sub" || typeof f.method !== "string") return;
					if (subs.has(sub) || subs.size >= 64) {
						send({ t: "end", sub, reason: "error" });
						return;
					}
					const controller = new AbortController();
					subs.set(sub, controller);
					void (async () => {
						let ready = false;
						let seq = 0;
						const queue: Array<{ type: string; data: unknown; ts: string }> = [];
						try {
							const def = await registry.prepareCall(f.method!, f.params ?? {}, ctx);
							if (!def.stream) throw new MethodError("invalid_params", "not a stream");
							const emit = (event: { type: string; data: unknown; ts: string }) =>
								send({ t: "ev", sub, seq: ++seq, cursor: "", ...event });
							let result = await registry.call(f.method!, f.params, ctx, controller.signal, async (data) => {
								const event = mapEvent(def.stream!.type, data);
								if (!event || controller.signal.aborted) return;
								if (!ready && queue.length >= 1000) {
									controller.abort();
									subs.delete(sub);
									send({ t: "end", sub, reason: "error", error: { code: "unavailable", message: "slow-consumer" } });
									return;
								}
								const item = { ...event, ts: new Date().toISOString() };
								if (ready) emit(item);
								else queue.push(item);
							});
							if (f.method === "sessions.watch") result = await sessionSnapshot((f.params as { id: string }).id, ctx);
							if (f.method === "views.watch")
								result = await registry.call("views.list", f.params, ctx, controller.signal);
							if (controller.signal.aborted) return;
							send({ t: "ready", sub, gap: true, cursor: "", result });
							ready = true;
							for (const event of queue) emit(event);
						} catch (error) {
							controller.abort();
							subs.delete(sub);
							const code = error instanceof MethodError ? error.code : "error";
							send({
								t: "end",
								sub,
								reason: code === "forbidden" ? "forbidden" : "error",
								error: { code, message: error instanceof Error ? error.message : "error" },
							});
						}
					})();
				},
			};
		},
	};
}
