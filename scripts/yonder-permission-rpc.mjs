// Pure launcher validation. Origin/capabilities are checked by the plugin using
// ToolContext, not asserted in this local transport's model-controlled JSON.
export const permissionKinds = [
	"accessibility",
	"screen-recording",
	"input-monitoring",
	"camera",
	"microphone",
	"notifications",
	"automation",
	"full-disk-access",
	"files-and-folders",
];
export function permissionCommand(args) {
	if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Invalid RPC arguments");
	if (["permission-request", "permission-guide", "permission-watch"].includes(args.action)) {
		if (!permissionKinds.includes(args.kind)) throw new Error("Invalid permission kind");
		const command = args.action.slice("permission-".length);
		const timeout = args.timeout ?? 600;
		if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0 || timeout > 600)
			throw new Error("Invalid timeout (0 < seconds <= 600)");
		if (command === "request" && args.timeout !== undefined)
			throw new Error("timeout is only supported for permission-guide/permission-watch");
		return command === "request" ? [command, args.kind] : [command, args.kind, "--timeout", String(timeout)];
	}
	if (
		!["status", "permissions", "screenshot", "snapshot", "move", "click", "drag", "type", "key"].includes(args.action)
	)
		throw new Error("Unknown desktop RPC action");
	return undefined;
}
