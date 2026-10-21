# MCP client

Official MCP SDK 1.32.1 client; independent from Yonder's existing MCP server.

Select `mcp-client_stdio` and/or `mcp-client_http` as tools. Both require `read`, `write`, and `message`; stdio additionally requires `exec`, HTTP/SSE requires `network`. This deliberately conservative boundary includes external tools with unknown side effects. Stdio supports only `node:local`. External server content never grants permissions.

Plugin configuration has a `servers` map. Each server declares `transport` (`stdio`, `http`, `sse`), either `command`/`args`/optional `cwd` or `url`. Credentials use `envCredentials` or `headerCredentials` maps from environment/header name to Yonder credential reference (currently `api_key`); values are resolved only in the transport, never returned. HTTP URL credentials/query/fragment are rejected; use header references. Do not place secrets in command arguments, URLs or server names.

A tool call selects `server` and `action`:

- `status`, `connect`, `disconnect`, `forget` manage connections/configuration. `connect` may supply `config` and `persistence`: `session` (default, memory only) or `persistent` (saved under plugin data, owned by the creating session across process restarts). Configured server definitions are available to selected tools in each session; live connections are always session-owned and lazy. Disconnect retains configuration; forget removes only that session's override, leaving administrator configuration intact.
- `tools`, `resources`, `templates`, `prompts` return protocol discovery pages, accepting `cursor`. Tool schemas are returned on request, never registered en masse in model context.
- `call` uses original `name` and `arguments` unchanged; server identity remains a separate field. `read` uses resource `uri`. `prompt` uses original `name` and string-valued `arguments`. `instructions` returns handshake instructions with provenance.

Select context `mcp-instructions` to expose instructions from this session's already connected servers in turn context. This context never initiates network/process work or elevates instructions to system policy. Prompts, resources and tool results retain server provenance as external material.

A dead connection is discarded; the next requested operation reconnects. Failed or cancelled calls are never replayed automatically. Requests follow the caller signal; SDK protocol request timers are set to the maximum Node timer duration so ordinary long tools use Yonder's shared background execution rather than the SDK's default 60-second timeout. Session close, disconnect and plugin stop close owned transports; SDK stdio close terminates its child. Captured stderr is drained without logging secrets. Explicitly supplied secrets are redacted in results/errors/instructions, including JSON escapes.

OAuth-only services currently report the SDK's real authorization failure. No OAuth callback/UI or token store is implemented, and no other client's login is imported. An administrator can provide an already authorized bearer value through a credential-backed Authorization header. This is not a promise of authorization-free access.

Build: `npx tsc -b plugins/mcp-client`. Real local protocol verification: `node plugins/mcp-client/test/integration.mjs` after build. This starts official SDK servers using actual local filesystem reads across stdio, StreamableHTTP and SSE; no model or external account is used.

Standard MCP image content is returned through Yonder tool images; audio and resource blobs are saved under plugin data/artifacts with actual attachment file URIs. Text output keeps MIME, byte counts, original source/resource URI and artifact metadata, never standard media base64. Text and structuredContent remain unchanged. The same mapping covers prompt content and resource reads. Focused real SDK media verification: `node plugins/mcp-client/test/media.mjs` (macOS, uses the repository's actual PNG and the system Glass.aiff sound; does not play audio).
