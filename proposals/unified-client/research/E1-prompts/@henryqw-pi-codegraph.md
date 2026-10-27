# @henryqw/pi-codegraph — 注入模型的提示词原文

- 包: `@henryqw/pi-codegraph` 0.7.3
- License: MIT (Copyright (c) 2026 Henry Wang) — `/Users/zoran/.pi/agent/npm/node_modules/@henryqw/pi-codegraph/LICENSE`
- 仓库: https://github.com/HenryQW/pi-harness (extensions/pi-codegraph)
- 来源: `/Users/zoran/.pi/agent/npm/node_modules/@henryqw/pi-codegraph/extensions/codegraph.ts` 的 `pi.registerTool({ name: "codegraph_explore", ... })`

## codegraph_explore

```text
pi.registerTool({
		name: "codegraph_explore",
		label: "CodeGraph explore",
		description: "Primary code exploration tool. Call it first for how-does-X-work, architecture, bug, or where-is-X questions, and before editing. Returns the verbatim source of the relevant symbols grouped by file, plus the call path among them, in one capped call. Treat the shown source as already read.",
		parameters: Type.Object({
			query: Type.String({ description: "Symbol names, file names, short code terms, or a natural-language question." }),
			maxFiles: Type.Optional(Type.Number({ description: "Maximum files to include (default 12)." })),
			projectPath: Type.Optional(Type.String({ description: "Absolute path to the project or any directory inside it. Defaults to the session cwd." })),
		}),
		annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
```
