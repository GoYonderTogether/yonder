# Implementation references

This plugin uses the official Playwright API (`playwright-core`, Apache-2.0) for browser lifecycle, selectors, ARIA snapshots and screenshots. It does not implement its own CDP client or embed an agent runtime.

The following local upstream implementations were reviewed for approach and boundaries; no source module was copied:

- OpenClaw, MIT, Copyright (c) 2026 OpenClaw Foundation: `extensions/browser/src/browser/pw-session-actions.ts` and `pw-tools-core.snapshot.ts` (Playwright page lifecycle and snapshots).
- Hermes Agent, MIT, Copyright (c) 2025 Nous Research: `hermes_cli/clipboard.py` and `tools/terminal_tool_macos_open.py` (native `osascript` subprocess invocation and macOS permission/focus boundaries). This plugin deliberately does not use their app-activation commands.

Desktop input is original fixed-operation JXA using system CoreGraphics/System Events; screenshots use macOS `screencapture`. No external desktop service, credential, browser profile or driver account is imported.
