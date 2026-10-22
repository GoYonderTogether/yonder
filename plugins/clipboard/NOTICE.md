# Clipboard provenance

The kernel is Apple's installed Security.framework, used through its public
SecItem APIs. No Apple implementation is copied or distributed. Our Swift
adapter is Apache-2.0. Pipe-only transport, safe child errors and denied UI build
on the earlier Apache-2.0 Yonder secrets-plugin branch (7fcd217); the KDBX installer,
master-key helper and MV3 code are not copied. KeePassXC is a researched fallback,
not bundled or silently invoked. Its GPL-2.0+ executable was only used for an
isolated scratch smoke test. See docs/research/vault-kernel.md.

Hidden TTY input is adapted from this repository's packages/cli/src/credential-input.ts
(Apache-2.0), with a finite byte limit. Secret-reference / trusted-child injection
semantics are inspired by 1Password CLI documentation; no 1Password code is copied.
