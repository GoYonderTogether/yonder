# SCHEMA

How to read and write this memory. The plugin generates this file once; the owner may edit it.

## Rules

1. Facts beat inferences. `confirmed` beats `inferred`. Concrete behaviour beats an abstract label.
2. If it is not in the memory, do not fill it in. Say you don't know.
3. When two entries conflict, flag both and let the owner decide. Never overwrite silently.
4. Priority when recalling: current tasks and recent events, then concrete experiences, then stable values and preferences, then interest tags, then basic profile.
5. Anything from an `agent`, `derived` or `legacy` origin is a hypothesis, not evidence.
6. Organizing only flips `[ ]` to `[x]` and records where the item went. Never edit the original text of a record.
7. The owner confirms plans and facts. Propose, then wait for a clear yes in conversation.
8. `private/` content stays out of context and out of default search.

## Layout

See the plugin README: `mine/` (owner's own writing, never written by the plugin), `raw/`, `inbox/`, `life/`, `timeline/`, `me/`, `projects/`, `private/`, `archive/`.

## Record lines

`- [ ] HH:MM {source} text (ref: …) ^id` — `[ ]` unorganized, `[x]` organized with `→ destination`.
