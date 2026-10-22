# Memory plugin loader integration acceptance

Scope: one executable integration test exercises the formal core `loadPlugins` loader against the built `@yonder/plugin-memory` package and invokes the registered `memory_read` and `memory_search` handlers. This is a plugin-loader + tool-handler integration test, **not** a model E2E test; no Runtime/model provider is involved.

The test creates a temporary plugin home and memory root with synthetic public fixture content, configures an owner, the `main` agent and one approved conversation, and supplies only external kernel service boundaries (including identity-account lookup). It verifies successful read/search plus rejection for an unapproved agent and conversation. No production/personal data, credentials, real channel, converter, model, or publication is used.

Run: `npx vitest run plugins/memory/test/loader-acceptance.test.ts`
