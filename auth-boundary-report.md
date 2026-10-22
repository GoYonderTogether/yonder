# Memory auth-boundary B1 report

## Decision / enforcement

- Added `allowedSourceConversations: string[]` to memory config; absent/empty means no conversation is authorized.
- One shared `ownerEvent` helper gates both memory contexts and every registered memory tool. It requires an allowlisted agent, `message.in`, an `acct:` sender resolved by `identity.account()` to configured owner, and a non-empty exact `event.conv` match in the admin-maintained conversation allowlist.
- Missing conversation IDs are rejected. No fallback to sender/account refs is used. Models and tool arguments cannot set/change either allowlist.
- README calls this explicit per-conversation administrator approval and explicitly says Yonder does not infer private-message semantics from SDK metadata.
- Updated test fixtures to represent the approved owner agent/account/conversation; added denial coverage for unapproved conversation, wrong owner, wrong agent, absent event, and missing conversation.

## Validation

- `npx vitest run plugins/memory/test`: **36 passed, 0 failed, 2 skipped** (8 files). The 2 skips are existing real-model tests not enabled in this run; no real-model/B2 validation is claimed.
- `npm run typecheck`: passed.
- `npx biome check --max-diagnostics=100 plugins/memory/src plugins/memory/test`: passed (exit 0); existing informational/warning diagnostics remain, including non-null assertions and style warnings across the memory package. No new errors.
- No production data or live accounts used. No push performed.

## Scope boundary

B1 only. B2 remains untested; there was no evidence here to claim channel-level private-message detection, and no such detection was introduced. Runtime access remains closed by default until an administrator configures the exact authorized agent and conversation identifiers.
