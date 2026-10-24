import type { PermissionRequest, PermissionsAPI, Tool } from "@yonder/sdk";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { coreToolCapabilities } from "./catalog.js";

const parameters = Type.Union([
	Type.Object({ action: Type.Literal("list") }, { additionalProperties: false }),
	Type.Object(
		{
			action: Type.Union(["status", "request", "guide", "watch"].map((v) => Type.Literal(v))),
			provider: Type.String({ minLength: 1 }),
			kind: Type.String({ minLength: 1 }),
			timeout: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
		},
		{ additionalProperties: false },
	),
]);
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
				if (!Value.Check(parameters, input)) throw new Error("Invalid permissions arguments");
				const request = input as PermissionRequest | { action: "list" };
				return {
					text: JSON.stringify(
						request.action === "list" ? await permissions.list(ctx) : await permissions.invoke(request, ctx),
					),
				};
			} catch (error) {
				return { text: String(error), isError: true };
			}
		},
	};
}
