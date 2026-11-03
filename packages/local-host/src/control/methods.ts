import { activityMethods } from "@yonder/local-host/control/activity-methods";
import { approvalsMethods } from "@yonder/local-host/control/approvals-methods";
import { attachmentsMethods } from "@yonder/local-host/control/attachments-methods";
import { botMethods } from "@yonder/local-host/control/bot-methods";
import { capabilitiesMethods } from "@yonder/local-host/control/capabilities-methods";
import { catalogMethods } from "@yonder/local-host/control/catalog-methods";
import { configMethods } from "@yonder/local-host/control/config-methods";
import type { ControlHandler } from "@yonder/local-host/control/index";
import { legacyMethods } from "@yonder/local-host/control/legacy-methods";
import {
	allScopes,
	type HostCtx,
	type MethodDef,
	MethodError,
	type Principal,
	type Scope,
} from "@yonder/local-host/control/method-types";
import { notifyMethods } from "@yonder/local-host/control/notify-methods";
import { sessionMethods as base } from "@yonder/local-host/control/session-methods";
import { sessionOpenMethods } from "@yonder/local-host/control/session-open-methods";
import { socialMethods } from "@yonder/local-host/control/social-methods";
import { updateMethods } from "@yonder/local-host/control/update-methods";
import { viewsMethods } from "@yonder/local-host/control/views-methods";
import { workbenchOptionsMethods } from "@yonder/local-host/control/workbench-options-methods";
import { Errors } from "typebox/value";

export * from "@yonder/local-host/control/method-types";

const defs: MethodDef[] = [
	...base,
	...capabilitiesMethods,
	...viewsMethods,
	...configMethods,
	...catalogMethods,
	...sessionOpenMethods,
	...legacyMethods,
	...activityMethods,
	...notifyMethods,
	...approvalsMethods,
	...botMethods,
	...updateMethods,
	...socialMethods,
	...workbenchOptionsMethods,
	...attachmentsMethods,
];

export interface MethodFacts {
	scope: Scope;
	stream?: true;
	local?: true;
	since: number;
}

export const registry = {
	get: (name: string) => defs.find((def) => def.name === name),
	list: () => defs,
	/** Methods visible to a principal: granted scope only, and no `local` method off the control socket. */
	facts(principal: Principal): Record<string, MethodFacts> {
		return Object.fromEntries(
			defs
				.filter((def) => principal.scopes.includes(def.scope) && (!def.local || principal.transport === "socket"))
				.map((def) => [
					def.name,
					{
						scope: def.scope,
						...(def.stream ? { stream: true as const } : {}),
						...(def.local ? { local: true as const } : {}),
						since: def.since,
					},
				]),
		);
	},
	/** Look up, authorise and validate; throws MethodError. Does not run the handler. */
	prepare(name: string, params: unknown, principal: Principal): MethodDef {
		const def = registry.get(name);
		if (!def) throw new MethodError("unknown_method", `unknown control method: ${name}`);
		if ((def.local && principal.transport !== "socket") || !principal.scopes.includes(def.scope))
			throw new MethodError("forbidden", `${name} requires ${def.local ? "a local connection" : `${def.scope} scope`}`);
		const errors = Errors(def.params, params);
		if (errors.length)
			throw new MethodError(
				"invalid_params",
				errors.map((error) => `${error.instancePath || "/"}: ${error.message}`).join("; "),
			);
		return def;
	},
	/** Prepare a request with audit for policy updates rejected before their handler. */
	async prepareCall(name: string, params: unknown, ctx: HostCtx): Promise<MethodDef> {
		try {
			return registry.prepare(name, params, ctx.principal);
		} catch (error) {
			if (
				name === "social.update" &&
				error instanceof MethodError &&
				(error.code === "forbidden" || error.code === "invalid_params")
			)
				await ctx.kernel.social.auditDenied(ctx.principal, params, error.code);
			throw error;
		}
	},
	async call(
		name: string,
		params: unknown,
		ctx: HostCtx,
		signal: AbortSignal,
		emit: (value: unknown) => Promise<void> = async () => {},
	): Promise<unknown> {
		const def = await registry.prepareCall(name, params ?? {}, ctx);
		return def.handler(params ?? {}, ctx, signal, emit);
	},
};

export const socketPrincipal: Principal = { id: "socket", transport: "socket", kind: "local", scopes: allScopes };

/** control.sock handler: same wire format as before, dispatching through the registry. */
export function controlHandler(host: Omit<HostCtx, "principal">): ControlHandler {
	return async (request, connection) => {
		const params = (request.params ?? {}) as Record<string, unknown>;
		const def = registry.get(request.method);
		const legacy = def?.stream?.legacyFrame;
		// Spread per request: the daemon attaches `gateway` after the socket is already serving.
		const ctx: HostCtx = { ...host, principal: socketPrincipal };
		return registry.call(request.method, params, ctx, connection.signal, async (value) =>
			connection.send(legacy ? legacy(params, value) : value),
		);
	};
}
