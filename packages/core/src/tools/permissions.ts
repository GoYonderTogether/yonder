import type { PermissionRequest, PermissionsAPI, Tool } from "@yonder/sdk";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { coreToolCapabilities } from "./catalog.js";

type PermissionAction = "list" | "status" | "request" | "guide" | "watch";
type PermissionArguments = { action: PermissionAction; provider?: string; kind?: string; timeout?: number };

// One top-level object: a union at the root is rejected by strict provider APIs (DeepSeek reports "type: null").
const parameters = Type.Object(
	{
		action: Type.Union(["list", "status", "request", "guide", "watch"].map((value) => Type.Literal(value))),
		provider: Type.Optional(Type.String({ minLength: 1 })),
		kind: Type.Optional(Type.String({ minLength: 1 })),
		timeout: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
	},
	{ additionalProperties: false },
);
export function createPermissionsTool(permissions: PermissionsAPI): Tool {
	return {
		name: "permissions",
		capabilities: coreToolCapabilities.permissions ?? [],
		description:
			"Shared permission interface. List providers enabled for this session/profile, then status/request/guide/watch one provider and kind. Status never requests access. Results describe the actual platform and responsible identity; requested/unknown is not granted. Timeout is seconds, subject to provider limits. OS approval remains human; never return credentials.",
		parameters,
		async execute(input, ctx) {
			try {
				ctx.signal.throwIfAborted();
				if (ctx.profile === "outsider") throw new Error("Permission providers are not available to outsiders");
				if (!Value.Check(parameters, input)) throw new Error("Invalid permissions arguments");
				const request = input as PermissionArguments;
				if (request.action === "list") {
					if (request.provider !== undefined || request.kind !== undefined || request.timeout !== undefined)
						throw new Error("Invalid permissions arguments");
					return { text: JSON.stringify(await permissions.list(ctx)) };
				}
				if (request.provider === undefined || request.kind === undefined)
					throw new Error("Invalid permissions arguments");
				return {
					text: JSON.stringify(await permissions.invoke(request as PermissionRequest, ctx)),
				};
			} catch (error) {
				return { text: String(error), isError: true };
			}
		},
	};
}
