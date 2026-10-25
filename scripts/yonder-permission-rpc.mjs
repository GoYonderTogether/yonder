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
	"location",
];
export function absoluteFilePath(value) {
	if (typeof value !== "string" || !value.startsWith("/") || value.includes("\0") || value.split("/").includes(".."))
		throw new Error("Expected absolute path without NUL or ..");
	return value;
}
export function permissionCommand(args) {
	if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Invalid RPC arguments");
	if (["location-status", "location-request", "location-collect"].includes(args.action)) {
		if (Object.keys(args).some((key) => !["action", "timeout"].includes(key)))
			throw new Error("Location accepts only action and optional timeout");
		if (
			args.timeout !== undefined &&
			(typeof args.timeout !== "number" || !Number.isFinite(args.timeout) || args.timeout <= 0 || args.timeout > 60)
		)
			throw new Error("Invalid location timeout (0 < seconds <= 60)");
		return undefined;
	}
	if (["file-list", "file-export"].includes(args.action)) {
		absoluteFilePath(args.path);
		if (args.action === "file-export") absoluteFilePath(args.destination);
		return undefined;
	}
	if (["permission-request", "permission-guide", "permission-watch"].includes(args.action)) {
		if (!permissionKinds.includes(args.kind)) throw new Error("Invalid permission kind");
		if (args.kind === "location" && args.action !== "permission-request")
			throw new Error("Location supports status/request/collect RPC, not guide/watch");
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
