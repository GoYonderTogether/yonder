import { Errors } from "typebox/value";
import { activityMethods } from "./activity-methods.js";
import { approvalsMethods } from "./approvals-methods.js";
import { botMethods } from "./bot-methods.js";
import { capabilitiesMethods } from "./capabilities-methods.js";
import { catalogMethods } from "./catalog-methods.js";
import type { ControlHandler } from "./index.js";
import { legacyMethods } from "./legacy-methods.js";
import { allScopes, type HostCtx, type MethodDef, MethodError, type Principal, type Scope } from "./method-types.js";
import { notifyMethods } from "./notify-methods.js";
import { sessionMethods as base } from "./session-methods.js";
import { sessionOpenMethods } from "./session-open-methods.js";
import { socialMethods } from "./social-methods.js";
import { updateMethods } from "./update-methods.js";
import { viewsMethods } from "./views-methods.js";

export * from "./method-types.js";

const defs: MethodDef[] = [
	...base,
	...capabilitiesMethods,
	...viewsMethods,
	...catalogMethods,
	...sessionOpenMethods,
	...legacyMethods,
	...activityMethods,
	...notifyMethods,
	...approvalsMethods,
	...botMethods,
	...updateMethods,
	...socialMethods,
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
	async call(
		name: string,
		params: unknown,
		ctx: HostCtx,
		signal: AbortSignal,
		emit: (value: unknown) => Promise<void> = async () => {},
	): Promise<unknown> {
		const def = registry.prepare(name, params ?? {}, ctx.principal);
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
