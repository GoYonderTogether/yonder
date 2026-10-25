import type { PermissionProvider, PermissionRequest, PermissionsAPI, ToolContext } from "@yonder/sdk";

/** One kernel registry; selection is resolved from the calling session, never the core tool's identity. */
export function createPermissions(selected: (ctx: ToolContext) => Promise<readonly string[]>): PermissionsAPI {
	const providers = new Map<string, PermissionProvider>();
	return {
		register(provider) {
			if (providers.has(provider.id)) throw new Error(`Duplicate permission provider: ${provider.id}`);
			providers.set(provider.id, provider);
		},
		async list(ctx) {
			ctx.signal.throwIfAborted();
			const plugins = await selected(ctx);
			ctx.signal.throwIfAborted();
			return [...providers.values()]
				.filter((p) => plugins.includes(p.id.split(".")[0] ?? ""))
				.map(({ id, scope, kinds }) => ({ id, scope, kinds: [...kinds] }));
		},
		async invoke(request: PermissionRequest, ctx) {
			ctx.signal.throwIfAborted();
			if (
				!request ||
				typeof request !== "object" ||
				Object.keys(request).some((key) => !["provider", "action", "kind", "timeout"].includes(key)) ||
				typeof request.provider !== "string" ||
				typeof request.kind !== "string" ||
				!request.kind.trim() ||
				!["status", "request", "guide", "watch"].includes(request.action) ||
				(request.timeout !== undefined &&
					(typeof request.timeout !== "number" || !Number.isFinite(request.timeout) || request.timeout <= 0))
			)
				throw new Error("Invalid permission request");
			const provider = providers.get(request.provider);
			if (!provider) throw new Error(`Unknown permission provider: ${request.provider}`);
			if (!(await selected(ctx)).includes(provider.id.split(".")[0] ?? ""))
				throw new Error(`Permission provider not enabled in this session/profile: ${provider.id}`);
			ctx.signal.throwIfAborted();
			if (!provider.kinds.includes(request.kind)) throw new Error(`Unknown permission kind: ${request.kind}`);
			const response = await provider.invoke(request, ctx);
			ctx.signal.throwIfAborted();
			return response;
		},
	};
}
