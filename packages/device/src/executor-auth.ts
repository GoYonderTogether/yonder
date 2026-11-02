import type { KeyObject } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { verifyMessage } from "@yonder/protocol";

const verificationReasons = [
	"key-id",
	"principal",
	"signature",
	"invalid-now",
	"future",
	"expired",
	"invalid-window",
] as const;
export type ExecutorDiagnostic = {
	stage: "authentication" | "persistence";
	reason: string;
	offsetMs?: number;
};

/** One record per fixed category per daemon, never per attacker-controlled request/offset. */
export class ExecutorDiagnostics {
	private readonly reported = new Set<string>();
	constructor(private readonly emit: (diagnostic: ExecutorDiagnostic) => void) {}
	private report(diagnostic: ExecutorDiagnostic): void {
		const key = `${diagnostic.stage}:${diagnostic.reason}`;
		if (this.reported.has(key)) return;
		this.reported.add(key);
		this.emit(diagnostic);
	}
	verification(error: unknown): { futureMs?: number } {
		const cause = error instanceof Error ? error.cause : undefined;
		const value = cause && typeof cause === "object" ? (cause as { verification?: unknown; offsetMs?: unknown }) : {};
		const reason = verificationReasons.find((reason) => reason === value.verification) ?? "rejected";
		const offsetMs =
			(reason === "future" || reason === "expired") &&
			typeof value.offsetMs === "number" &&
			Number.isSafeInteger(value.offsetMs)
				? value.offsetMs
				: undefined;
		this.report({ stage: "authentication", reason, ...(offsetMs === undefined ? {} : { offsetMs }) });
		return reason === "future" && offsetMs !== undefined && offsetMs > 0 ? { futureMs: offsetMs } : {};
	}
	persistence(error: unknown): void {
		const code = (error as NodeJS.ErrnoException | undefined)?.code;
		const reason = ["EACCES", "EPERM", "EIO", "ENOSPC", "EROFS"].find((reason) => reason === code) ?? "failed";
		this.report({ stage: "persistence", reason });
	}
}

export async function verifyRequest(
	envelope: unknown,
	key: KeyObject,
	expected: Parameters<typeof verifyMessage>[2],
	signal: AbortSignal,
	diagnostics: ExecutorDiagnostics,
) {
	for (;;) {
		signal.throwIfAborted();
		try {
			return verifyMessage(envelope, key, { ...expected, now: Date.now() });
		} catch (error) {
			// Called only around the local verifier, after the adapter envelope has been snapshotted.
			const { futureMs } = diagnostics.verification(error);
			if (futureMs === undefined) throw error;
			await delay(Math.min(1_000, futureMs), undefined, { signal });
		}
	}
}
