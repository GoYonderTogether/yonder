import type { Tool, ToolContext, ToolResult } from "@yonder/sdk";
import { Type } from "typebox";
import type { Db } from "./db.js";
import { LoginOperations, type LoginOutcome } from "./login-operations.js";

export interface LoginRunner {
	start(input: {
		id: string;
		capability: string;
		provider: string;
		finish(outcome: LoginOutcome, code: number): Promise<boolean>;
	}): Promise<void>;
}
export type LoginDelivery = (
	entry: Awaited<ReturnType<LoginOperations["readUnacknowledged"]>>[number],
	idempotencyKey: string,
) => Promise<"delivered" | "unknown">;
export interface LoginOperationServiceOptions {
	db: Db;
	runner: LoginRunner;
	deliver: LoginDelivery;
	now?: () => number;
	ttlMs?: number;
	deliveryTimeoutMs?: number;
	providers?: ReadonlySet<string>;
}
const result = (value: unknown): ToolResult => ({ text: JSON.stringify(value) });

/** Internal runtime adapter. Register its handler only from a trusted runtime, never as an arbitrary RPC endpoint. */
export function createLoginOperationService(options: LoginOperationServiceOptions) {
	const operations = new LoginOperations(options.db, options.now, options.ttlMs);
	const handler = async (args: { provider: string }, ctx: ToolContext): Promise<ToolResult> => {
		if (
			!args ||
			typeof args !== "object" ||
			Object.keys(args).some((key) => key !== "provider") ||
			typeof args.provider !== "string" ||
			!/^[a-z0-9_-]{1,64}$/i.test(args.provider)
		)
			throw new Error("Invalid login arguments");
		if (options.providers && !options.providers.has(args.provider)) throw new Error("Unsupported login provider");
		const operation = await operations.begin(ctx);
		try {
			await options.runner.start({
				id: operation.id,
				capability: operation.capability,
				provider: args.provider,
				finish: (outcome, code) => operations.finish(operation.capability, outcome, code),
			});
		} catch {
			await operations.finish(operation.capability, "failed", 1);
			throw new Error("Login operation could not be started");
		}
		return result({ id: operation.id, expiresAt: operation.expiresAt, status: "pending" });
	};
	const tool: Tool = {
		name: "login_begin",
		description: "Begin a provider login operation",
		parameters: Type.Object(
			{ provider: Type.String({ minLength: 1, maxLength: 64 }) },
			{ additionalProperties: false },
		),
		capabilities: ["write"],
		execute: async (args, ctx) => handler(args as { provider: string }, ctx),
	};
	return {
		operations,
		tool,
		handler,
		initialize: () => operations.initialize(),
		startDrain(intervalMs = 1_000): () => void {
			let stopped = false;
			let active: Promise<unknown> | undefined;
			const tick = () => {
				if (stopped || active) return;
				active = this.drainOutbox()
					.catch(() => undefined)
					.finally(() => {
						active = undefined;
					});
			};
			tick();
			const timer = setInterval(tick, intervalMs);
			timer.unref?.();
			return () => {
				stopped = true;
				clearInterval(timer);
			};
		},
		async drainOutbox(limit = 100): Promise<number> {
			await operations.expirePending();
			let acked = 0;
			for (const entry of await operations.readUnacknowledged(limit)) {
				if (!(await operations.claimDelivery(entry.id))) continue;
				let state: "delivered" | "unknown";
				let timer: ReturnType<typeof setTimeout> | undefined;
				try {
					state = await Promise.race([
						options.deliver(entry, entry.operationId),
						new Promise<"unknown">((resolve) => {
							timer = setTimeout(() => resolve("unknown"), options.deliveryTimeoutMs ?? 10_000);
						}),
					]);
				} catch {
					state = "unknown";
				} finally {
					if (timer !== undefined) clearTimeout(timer);
				}
				if (state !== "delivered") break;
				if (await operations.acknowledge(entry.id)) acked++;
			}
			return acked;
		},
	};
}
