import { createHash } from "node:crypto";
import { isAbsolute, relative, sep } from "node:path";
import type { ExecutionCapability, Grant } from "@yonder/protocol";

/** Codes the daemon may report back; anything else becomes INTERNAL_ERROR. */
export const errorCodes = new Set([
	"INVALID_REQUEST",
	"UNSUPPORTED_VERSION",
	"UNPAIRED",
	"UNAUTHORIZED",
	"WRONG_TARGET",
	"GRANT_EXPIRED",
	"GRANT_REVOKED",
	"LEASE_EXPIRED",
	"LEASE_STALE",
	"COMMAND_CONFLICT",
	"COMMAND_NOT_FOUND",
	"BUSY",
	"UNSUPPORTED_OPERATION",
	"OUTCOME_UNKNOWN",
	"INTERNAL_ERROR",
]);
export const fail = (code: string): never => {
	throw new Error(code);
};
export const now = () => new Date().toISOString();
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const has = (grant: Grant, capability: ExecutionCapability) => grant.capabilities.includes(capability);
export const covered = (resource: string, roots: string[]) =>
	isAbsolute(resource) &&
	roots.some((root) => {
		if (!isAbsolute(root)) return false;
		const path = relative(root, resource);
		return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
	});

/** Fires once per grant-set change; the relay connection is the only subscriber today. */
export class GrantListeners {
	private readonly listeners = new Set<() => void>();
	add(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	/** A failing listener must not corrupt the executor's durable state. */
	notify(): void {
		for (const listener of this.listeners) {
			try {
				listener();
			} catch {
				/* the next grant change retries the report */
			}
		}
	}
}
