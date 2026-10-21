# Codex tools

Official local Codex app-server bridge for Computer Use and bounded OpenAI hosted
search. This is a Yonder SDK plugin, not a replacement model loop or a second desktop
driver. It reuses the existing Codex login without reading/exporting credentials.

## Requirements and selection

- macOS with `codex` executable on the harness process PATH. The plugin starts
  `codex app-server` directly and inherits the host process network environment.
- Existing official Codex Computer Use plugin/service for desktop tools. The plugin
  does not install/copy proprietary programs or reload shared MCP services.
- Existing Codex account with hosted web search access. Search uses `gpt-6-luna`;
  Yonder's development agent may independently use `openai/gpt-6.1-sol`.
- Install this package via the normal Yonder plugin configuration and select its
  tools in the agent/profile (`codex-tools_*`). Shared installation/configuration
  is performed by the operator, outside the running maintainer service.

`codex-tools_status {}` returns the real upstream tool descriptions and schemas.
Read those first. `codex-tools_js` accepts `code`, optional `title` (1–80 characters)
and `timeout_ms` (positive integer, bounded by Node's timer limit). First invocation
and after `codex-tools_js_reset {}` must contain exactly one upstream entry such as
`await cua.getState();`. Its returned documentation describes native app discovery,
AX state, screenshots and input. Native screenshot image blocks go into Yonder's
existing ToolResult.images. Other content types remain visible as structured text.

Prefer BrowserSkill for browsers. The directly observed native getState can
report usable apps alongside browser turn-metadata errors; do not infer browser
readiness or manufacture Codex turn metadata. Keep focus unless the task explicitly
authorizes foreground actions. Observe fresh state after actions; do not blindly
reuse stale indices or replay uncertain side effects.

All tools require `exec`; search additionally requires `network`. Arbitrary CUA JS
is **not** a read-only tool despite upstream readOnlyHint annotations. Host exec is
not a sandbox. No extra agent permission or approval system is introduced.

## Lifetime and failures

One lazily owned app-server connection per active Yonder session/run; desktop JS
bindings persist during that run. Desktop and search use the same connection but
separate ephemeral threads. Concurrent calls in the same session return a busy
error rather than race the REPL. Different sessions have independent connections.
run.end releases resources; the registered lifecycle trigger also aborts/stops all
owned connections on shutdown. A subsequent run starts a fresh REPL.

Search has a 90-second total deadline, rejects non-search tools, checks MCP tools
are zero before turn/start and requires actual native webSearch items, URLs and a
completed answer. Results include the real model/thread/turn and mark external
content untrusted. No Tavily fallback or ordinary-answer-as-search substitution.
Inherited MCP servers are disabled by native per-key config overrides. A name with
config path separators is rejected explicitly rather than constructing an unsafe
or ineffective override. No global Codex config is modified.

Program missing, native service errors, RPC failures and permission failures are
returned rather than terminating other Yonder plugins. Discovery only means MCP
is exposed, not that Accessibility/Screen Recording is authorized. If the actual
native error requests a macOS permission, have the user authorize it in System
Settings and then read the app state again. Unknown failures are not labelled as
permission denial. Authentication is performed through the existing official
Codex login flow; this plugin never requests tokens.

Cancellation interrupts native search and releases its thread. Direct MCP calls
have no verified cancellation RPC: cancellation/transport failure closes only this
run's owned app-server, never a shared CUA service. An action **may already have
occurred**; read fresh state before deciding what to do. No automatic retry or
recovery/replay. Ephemeral threads use unsubscribe, not archive.

## Source checks and remaining acceptance

From the repository root, after dependencies are present:

```sh
npx tsc -b plugins/codex-tools
npx biome check plugins/codex-tools/src/ plugins/codex-tools/package.json plugins/codex-tools/tsconfig.json
```

This implementation round does not run or add tests. The existing tests are retained for the next acceptance round. Build/typecheck does not claim installed Yonder acceptance. The operator must still
verify selected tools through the installed Yonder agent: approved app discovery,
AX/screenshot image delivery, reversible interaction and observation, current
hosted search/native evidence, abort and shutdown cleanup. No frontmost actions
or system permission changes are required by the source checks.

Protocol reference: official Codex app-server schema generated by local CLI
0.160.1. Search behavior also references OpenClaw (MIT) commit
`cafa09e50556e08c2a04a670f16ac815482c5489`, files
`extensions/codex/src/app-server/{web-search,bounded-turn,thread-requests}.ts`.
No upstream generic execution platform or proprietary runtime is included.

Failure output includes a diagnostic category: program-missing, service-unavailable,
permission-not-authorized, login-required, cancelled, or call-failed. Permission
classification comes from the actual upstream error; discovery remains unverified.
Search source URLs are accepted only from native webSearch results and only for
HTTP(S); answer prose cannot manufacture search provenance. All native items are
retained alongside deduplicated source URLs. This source round makes no new desktop,
login, search, cancellation, or installed Yonder acceptance claim.
