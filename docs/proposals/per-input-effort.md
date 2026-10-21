# Proposal: per-input effort and optional routing

Status: **unapproved integration design**, not a change to frozen specifications. No private request transcript is included. Baseline: aaf23e3, pi-ai 1.3.0, durable source eca1f259bb08f4fa14a96b93b456e4684fe3c450.

## Existing evidence

- `packages/sdk/src/types.ts`: Profile.thinking already represents pi's seven effort levels; SessionInputData and Input lack execution options. PluginAPI.models is the upstream Models type, including classify. `packages/core/src/plugins/index.ts` passes the host models through.
- `packages/core/src/runtime/index.ts`: prepareRun resolves/clones configuration, then persists it in RunDoc; recovery uses that snapshot. applyConfiguration sets thinkingLevel from resolved profile. submit carries stable requestId and entry data through native submissions.
- `packages/pi-durable/src/harness/types.ts`: SubmissionDraft has no execution option. `inbox.ts` persists entry data and chooses users by queue mode. `agent.ts` defaults steeringMode/followUpMode to one-at-a-time, but a final boundary can select one of EACH together. Steer joins an already active run.
- pi-ai `models.ts`: getSupportedThinkingLevels uses reasoning and thinkingLevelMap; clampThinkingLevel prefers the first available at-or-above a recognized unsupported level, then below. Unknown strings use the first available, not the profile default.
- pi-ai's built-in OpenAI provider registers openai-decisions and filters classifier models for OAuth credentials. Existing Yonder custom model configuration supports chat schemas/protocols, not arbitrary classifier configuration. Upstream support is not evidence of credential availability or authorized context disclosure.

## Minimal proposed public contract (requires Codex review)

1. Add optional `execution: { effort?: string }` to message.in/session.input data and SDK task Input; accept the same option in agent_ask/task_run and user chat's structured submission path. Keep the raw request for audit. Do not parse arbitrary natural-language text into authoritative options. CLI spelling and channel prefix UX need review before implementation.
2. Effort-only first: no per-input provider/model switch in core. Resolve against the actually selected model and its metadata. For invalid strings choose the configured default normalized to model support; for recognized unsupported levels use pi's documented deterministic ordering. Record requested, effective, model, and fallbackReason. Empty supported sets fail, never invent support.
3. Authority is checked BEFORE resolution. Proposed minimal existing-capability mapping: agent-origin effort overrides require admin (in addition to the tool's existing capabilities), task capability intersection remains unchanged; user overrides require verified ownership relative to the target agent; trusted local management may submit. Unknown/unidentified/non-owner callers deny. These are proposals, not current permissions. No privileges from agent/profile names. Denial is an error, never invalid-level fallback. Incoming serialized `authorized` flags are never trusted. Persist actual caller provenance through native background invocation/recovery.
4. At run start, use an input-scoped clone of resolved profile, then persist effective effort and audit data with that run snapshot. Never mutate global/profile defaults or modify an active turn. A successor without options freshly resolves defaults; recovery keeps the admitted run decision and never reclassifies. Prefer existing native entry metadata, RunDoc and run.end extension fields, not a second queue or transcript.
5. **Isolation decision required:** a per-input option must not steer into an existing run or share a native run with unrelated input. Merely changing whenBusy to followUp does not fully solve this because final boundaries can combine steer and followUp. Review a native upstream submission isolation option/barrier that preserves queue order and survives restart; do not edit vendored durable directly. Alternative reject-before-admission semantics must be explicit to callers, not silently ignore effort. No broad changes to default steering behavior.
6. Audit denial separately from model fallback. Expose the effective decision to the originating caller and run-end observers, without echoing private message text or credentials.

## Optional external plugin (research pending)

No difficulty estimation/history/cost/vendor heuristics in core. Plugin explicitly selected by profile; removing it restores static execution. Reuse api.models.classify where authorized; no new paid service. Routing only among explicit model/provider allowlists, privacy constraints and budgets; owner explicit choice wins within those bounds. Classifier timeout/invalid output degrades once to static policy, never recursively routes. Unknown inference submission results do not authorize model switching/retry. Historical routing facts must be scoped to caller/session privacy; costs unknown/stale are labeled, not estimated as truth. Concrete routing implementation waits for independent source research and an approved generic admission seam.

## Staged delivery

- Current preparatory code: internal pure resolver and offline metadata tests. Not wired into input admission; it does not enable per-input effort in production.
- Review gates: permission mapping, public option naming/UX, audit fields and native isolation.
- After review: propagate user/chat/agent/task options through the shared admission path; implement native isolation via the approved pi fork process if needed; test permissions, invalid/unsupported effort, concurrent steers/followups, successors, restart and caller receipts.
- Offline tests use actual catalog metadata; no fake models. Real inference/decision invocation remains untested unless authorized credentials are available. No production configuration/install/restart changes.
