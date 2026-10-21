# @yonder/plugin-browser-skill

macOS-local SDK adapter to an existing BrowserSkill CLI/daemon/extension. No
browser engine, installer, browser permission changes or separate model loop.
All business commands use a fixed executable and argv (`shell:false`), with the
existing environment and `BSK_AUTO_START=0`. Remote ExecutionEnv is rejected.

## Integration (performed by the maintainer of shared installation wiring)

Add this package to the root workspace/lock and TS build references; include it
in the installed package set. Enable plugin ID `browser-skill` for the intended
profile, select skill `browser-skill`, and offer/search `browser-skill_*` tools.
Retain `NOTICE.md` and `LICENSE.browser-skill`, and add their attribution to the
root third-party notices. No new credentials are needed.

Optional plugin config: `{ "bskPath": "<verified executable>" }`; default is
`bsk` resolved on PATH. Do not add a second BSK_HOME or overwrite an existing
installation. Changing plugin config/code follows the existing service-external
restart procedure; the plugin does not update or restart Yonder.

`setup()` only registers seven tools, a packaged skill directory and a cleanup
trigger/listener. CLI absence/disconnection is diagnosed at tool invocation,
not a core startup failure. The cleanup trigger loads only the plugin's own
request facts at startup; it does not launch services or run recovery loops.
The state file is scoped to `api.paths.data` and contains only native
requestId/owner/session/browser identity plus active/cleanup state. Recovered
requests are not adopted as active: list and explicitly stop them. Shutdown and
`session.close` attempt cleanup of only owned requests. Cleanup errors remain
visible, with their records retained. Do not run multiple harness processes on
the same Yonder home/state directory.

## Tools

- `browser-skill_setup`: status, start-daemon, guide.
- `browser-skill_session`: start, stop, list.
- `browser-skill_page`: navigate, back, forward, reload, wait, wait-for-element.
- `browser-skill_inspect`: observe, snapshot, html, screenshot, console, network.
- `browser-skill_interact`: click, fill, select, press, hover, wheel, scroll-to,
  focus, blur, resize, emulate, request-help.
- `browser-skill_tabs`: list, create, select, close, borrow, return.
- `browser-skill_file`: upload, download (upstream supports local connections only).

All tools require `exec/read/network`; file also requires `write`. The readonly
profile cannot execute local programs through this adapter. Inputs are checked
against action-specific schemas before dispatch. Sessions belong to the calling
Yonder conversation; foreign session/request IDs cannot be adopted. Omitted
session is allowed only when exactly one request is owned. Start uses native
prepare/start/claim, always no-focus. Stop targets the stable native request and
continues cleanup when its caller cancels waiting. No automatic action replay,
mode fallback or session_busy retries are performed.

Text results identify BrowserSkill/bsk and retain native JSON fields (including
refs, cursors, truncation and effect-state errors). Screenshots return actual
`images` bytes with detected MIME, native dimensions and capture_id; their
private scratch directory is removed on success/error/cancellation. Source
results are tool data, not instructions. Never extract secrets or bypass a
browser-side confirmation. Read the packaged skill for complete upstream
operation and user-help constraints. SDK request-help currently uses manual
completion with prompt/title/targets/timeout, not automatic completion criteria.
Full debug experiments, video and bookmark tools are not registered.

## Local verification

From the repository root (after dependencies are installed):

```
node_modules/.bin/tsc -b packages/sdk plugins/browser-skill
node_modules/.bin/biome check plugins/browser-skill
node_modules/.bin/vitest run plugins/browser-skill/test/plugin.test.ts --exclude '**/dist/**'
```

Opt-in **real source-entry integration**, not installed Yonder/model acceptance:

```
node plugins/browser-skill/test/live.mjs status
node plugins/browser-skill/test/live.mjs guide
# Only after genuine absence was reported and no other task is starting it:
node plugins/browser-skill/test/live.mjs start-daemon
# Separate invocation verifies lifetime; only use the explicitly authorized ID:
node plugins/browser-skill/test/live.mjs page <verified-browser-instance>
```

`BSK_TEST_EXECUTABLE` can select an existing executable for this opt-in check.
The page check creates only a background Agent Window, navigates example.com,
observes/screenshots and stops its native request on success or failure; no user
tab borrowing. Evidence is written under the OS temp directory in
`yonder-n07-source-live/`. CLI/extension and page-task checks remain distinct from
subsequent installation/profile discovery and a real `openai/gpt-6.1-sol` run.
Never uninstall an existing extension to manufacture a disconnected test.
