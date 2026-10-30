# Clipboard and sealed handles

Program-owned byte transfer, with Apple Keychain on macOS and DPAPI CurrentUser on Windows as the secret
kernel. Local only; Windows stores only encrypted bytes in a private ACL-protected directory. No account, master password, extra vault executable or
secret-returning model tool. See [spec](../../docs/spec/15-clipboard-vault.md),
[research](../../docs/research/vault-kernel.md), and
[verification](../../docs/verification/clipboard-vault.md).

Add `@yonder/plugin-clipboard` with the existing `plugins add` management command
(or an explicit directory source when testing a checkout), and configure its
`config` in yonder.yaml. Adding it alone grants nothing. Select `clipboard` in the
intended profile's plugins and explicitly offer the `clipboard_*` tools there.

`config.grants` is an array of exact `{agent, profile, sealed, readRoots,
writeRoots, destinations, messageTargets}` entries. `agent` may be null for a
preset. Roots must be absolute existing directories; no wildcards. Each handle
also belongs to its creating session. Defaults are no grants, 256KiB open,
64KiB sealed, TTL 3600 seconds. `maxBytes` may be 1..1048576 and `ttlSeconds`
1..86400; per-copy TTL may only shorten the configured limit. File sources use
byte ranges, end exclusive. Use a real canonical path (macOS `/private/tmp`,
not its `/tmp` symlink).

`config.consumers` maps an operator-chosen id to one of:

- `{kind: child, file, args, cwd, variable}`: absolute executable/cwd, fixed argv,
  secret only in that program's environment, no shell or inherited credentials;
  stdout/stderr discarded, returns only ok/exitCode. Requires exec capability.
- `{kind: http, url, method, header?}`: one fixed HTTPS URL, POST/PUT, no URL
  credentials/query/fragment/redirects; secret becomes the named header or the
  complete body. TLS verification stays on. Returns only ok/status, discards
  response headers/body. Requires network capability. The recipient is trusted.

The grant must name each permitted consumer id. Tools do not accept commands,
URLs or environment variable names. An error/timeout does not prove absence of
external effects; do not automatically retry. Message destinations require an
explicit `messageTargets` ref plus the normal SDK capability check, and reject
sealed values. Files are create-only, mode 0600, fsync plus readback/hash checked;
existing files are never overwritten. Output parent directories must exist.

## Tools and trusted capture

- `clipboard_copy`: from `{kind:message,eventId}` (same inbound conversation),
  `{kind:file,path,start?,end?}`, or `{kind:tool,transcriptId}` (current session's
  pi.tool-result). Returns metadata. `class:sealed` only accepts file sources;
  chat/tool history is already visible. Default class is open.
- `clipboard_paste`: handle + `{kind:file,path}`, `{kind:consumer,id}`,
  `{kind:message,target}` (open UTF-8), or `{kind:vault}` (new sealed handle).
  Vaulting an open clip does **not** erase its original source or open blob.
- `clipboard_list`: current scope's unexpired metadata only.
- `clipboard_drop`: delete that scope's clip and own Keychain item, even expired.
  Existing pasted files, audit history and shared open blobs remain.
- `clipboard_capture`: creates a one-use TTL-bound ticket, returning two exact
  owner commands: `prepare` then `capture`. The owner runs them in an idle local
  TTY; entry is hidden, bounded and cancellable. Never send secrets in chat.
  A ticket delegates one capture until expiry; a later grant removal prevents
  tool use of the captured clip, but does not revoke an already issued ticket.

The separate `yonder-clipboard` package bin (or built `dist/capture.js` with node)
accepts only `prepare --data <absolute-plugin-data>` and
`capture --data <absolute-plugin-data> --ticket <id>`; no secret arguments,
pipes, environment input or read-secret command. `prepare` explicitly compiles
one small Swift helper, requiring installed Apple command-line tools. No setup
side effects occur on plugin installation. No automatic Keychain unlock/UI is
requested: OS denial fails closed. Keep the helper at its stable data path;
recompiling/re-signing may require owner ACL review. Do not delete it while
Keychain items exist.

Capture writes metadata-only audit journal files; the next authorized tool call
imports them into `clipboard.audit`, with a stable auditId. A crash may duplicate
an import, leaving the same id. Completed tool events include only ids/booleans/
counts/status. An interrupted capture ticket cannot be replayed; request a fresh
one. `clipboard_list` shows completed capture handles, never captured bytes.

## Boundary and cleanup

`clipboard-redact` filters exact UTF-8 sealed values (including JSON escapes)
from selected profiles' tool results and outbound complete messages. Restart
reloads values from Keychain; expiry still masks them. Any kernel read failure
suppresses unfiltered output. Images/attachments are suppressed while sealed
handles exist. Profiles with beforeSend buffer each individual message until
message_end, so a value split across deltas does not escape; other profiles keep
streaming. Unowned plugin messages do not borrow another profile's hooks.

This is not a sandbox. **Use a dedicated profile offering only the necessary
clipboard/consumer tools for secrets.** Unrestricted exec, other agents, raw
process output logs, local files, helper invocation, encoding, screenshots and
same-user processes can bypass these boundaries. Process tool results are
filtered, but its underlying raw shell log is not a secret store. Dropping a
handle stops its redaction; previously pasted/copied plaintext remains. SHA-256
metadata can reveal low-entropy values by guessing. JS strings/OS swapping are
not guaranteed wiped. Binary sealed bytes work for file/body transfer, but text
redaction cannot recognize encoded binary representations.

Expired items are denied but retained for explicit drop, including redaction.
Use the same owning session to list/drop handles before retiring a data directory;
list omits expired handles, so retain their metadata id for explicit drop. Only
delete Keychain service items proven to belong to this plugin data directory.
Shared open blobs, spent ticket claims and scratch files may be removed offline
after their scopes are retired. Crash-orphaned items have the service
`org.goyonder.clipboard.<sha256(canonical-plugin-data-path)>`; inspect metadata and
have the owner remove only matching items. There is no automatic garbage
collector or permission fallback to another vault.

Browser capture/fill and Feishu pre-ledger private capture are **BLOCKED**: no
reviewed secret-safe adapter exists in the current SDK. They are not registered.
KeePassXC is a researched fallback, not an implemented runtime switch. D50
credentials auth.json and D51 source-message delegation remain unchanged.
