# Progress observer claim-cancel verification

Implemented bounded cancellation for the current in-memory ledger attempt. A pre-send recheck plus durable `markSending` boundary rejects quiet/rate changes immediately before sender invocation. Cancellation is limited to the matching attempt while delivery is unknown and send has not been entered; it resets delivery to `not_sent`, clears the attempt/claims, and leaves pending evidence intact. Attempts already past the boundary and stale attempt IDs cannot be cancelled. The sender remains injected and is not called in these cancellation cases.

Verification: progress-observer tests (21 passed), TypeScript project build, and scoped Biome checks pass. No cross-process lock was added. No real sender/model/production delivery or push was performed.
