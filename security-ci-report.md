# Memory security review and CI report

## B3 converter input boundary

- `converter.command`, `args`, and timeout remain administrator-controlled configuration. The converter is not exposed as model- or attachment-supplied input; invocation uses a fixed argument array via `execFile`.
- Ingestion refuses links/non-regular files, files over the configured attachment limit (25 MiB default), and unsupported/mismatched document extensions. PDF and DOCX inputs are checked for their expected file signatures before invoking the converter. An absent converter remains a hard refusal for non-text files.
- Tests use synthetic fixtures and a fake executable; they do not claim malware scanning, sandboxing, or validation of real-world documents. Same-UID races after checks and vulnerabilities in the configured converter remain possible.

## Verification

- Targeted `plugins/memory/test/wp4.test.ts`: passed (5 passed, 1 optional real-converter integration skipped).
- Full suite `npm test -- --maxWorkers=4`: passed (71 files passed, 17 skipped; 309 tests passed, 34 skipped).
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm run lint`: failed due to an existing repository-wide Biome error; it reports 304 existing warnings and one error (not in files changed by this review). No lint findings are introduced in the changed memory files.
- CI run 39837076399 failed: `rg` was absent on the runner, causing tests that explicitly expect ripgrep to be available to fail. The workflow now installs ripgrep; it does not skip those tests or provide a fallback implementation.
