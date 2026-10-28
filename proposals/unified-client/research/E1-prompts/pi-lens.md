> 证据材料，结论已并入 [agent-parity.md](../../agent-parity.md)

# pi-lens — 注入模型的提示词原文

- 包: `pi-lens` 4.4.6
- License: MIT (Copyright (c) 2026 Apostolos Mantzaris and pi-lens contributors) — `~/.pi/agent/npm/node_modules/pi-lens/LICENSE`
- 仓库: https://github.com/apmantza/pi-lens
- 来源: `~/.pi/agent/npm/node_modules/pi-lens/dist/index.js`（bundle）—— 每个 `create*Tool()` 返回对象的 `name`/`label`/`description`/`promptSnippet`；`TOOL_REGISTRY` 提供 `summary` 用于 `pi_lens_activate_tools` 的目录
- 注入方式: 7 个常驻工具 + `pi_lens_activate_tools` 常驻；5 个 situational 工具（ast_grep_search/ast_grep_replace/ast_grep_outline/lsp_navigation/lens_diagnostic_mark）默认不激活，由 `pi_lens_activate_tools` 通过 `pi.setActiveTools` 打开。工具 description 只放契约句 + 一个例子，运行期指导放在结果里
- 另: `package.json.pi.skills = ["./skills"]`，4 个技能（pi-lens-ast-grep、pi-lens-lsp-navigation、pi-lens-write-ast-grep-rule、pi-lens-write-tree-sitter-rule）经 skills 段进入系统提示词；`updateLspStatus()` 用 `setStatus("pi-lens-lsp", …)` 写底栏状态

## 工具 description / promptSnippet

### ast_grep_search

description:

```text
"Search source by AST structure rather than text. Example: find calls with `console.log($MSG)`."
```

promptSnippet:

```text
"Search source by AST structure"
```

### ast_grep_replace

description:

```text
'Find and rewrite code by AST structure; preview by default. Example: `{pattern: "var $X", rewrite: "let $X", apply: false}`.'
```

promptSnippet:

```text
"Preview an AST-aware code rewrite"
```

### ast_grep_outline

description:

```text
"Return syntax-only symbols, imports, exports, and members with ast-grep. An outline shows structure, not a symbol body, and does not satisfy read-before-edit; use read_symbol or read_enclosing for body coverage. Example: outline `src/` before choosing a symbol to read."
```

promptSnippet:

```text
"Inspect syntax without index or LSP"
```

### lsp_navigation

description:

```text
'Navigate source with language-server operations such as definition, references, hover, and rename. Example: use `{operation: "references", path: "src/app.ts", line: 12}`.'
```

promptSnippet:

```text
"Navigate definitions and references with LSP"
```

### lens_diagnostics

description:

```text
'Query pi-lens diagnostics from the session cache or an active LSP probe, at paths or workspace scope. Empty cache is not proof of clean; probe changed paths when findings are absent or stale. Example: `{source: "lsp", scope: "paths", paths: ["src/app.ts"]}`.'
```

promptSnippet:

```text
"lens_diagnostics source=session reads the session cache and an empty cache is not proof of a clean file; use source=lsp scope=paths for changed files when cached findings are absent or stale"
```

### lens_diagnostic_mark

description:

```text
"Record a disposition for a diagnostic. Exact reported identity is required; suppress re-anchors against live diagnostics and writes an inline ignore comment, apply multiple suppressions bottom-up, and defer is session-only. Example: mark a false positive with its reported file, line, rule, and message."
```

promptSnippet:

```text
(none)
```

### symbol_search

description:

```text
"Find relevant files by ranked identifier search. On a cold cache, project_report and symbol_search return available: false with a retry hint and start a non-blocking background build; module_report degrades to outline-only with cache freshness explicit. Example: search `authenticate user` before module_report."
```

promptSnippet:

```text
"Find files by identifier"
```

### module_report

description:

```text
"Return a navigable source-module outline with symbols, references, and read handles. An outline shows shape, not bodies, and does not satisfy read-before-edit; `read_symbol` and `read_enclosing` return body text and record read coverage. On a cold cache, project_report and symbol_search return available: false with a retry hint and start a non-blocking background build; module_report degrades to outline-only with cache freshness explicit. Example: use module_report on `src/app.ts` before read_symbol."
```

promptSnippet:

```text
"Outline a source module before reading a body"
```

### project_report

description:

```text
"Orient in a project from its review graph, with ranked hubs and entry points. On a cold cache, project_report and symbol_search return available: false with a retry hint and start a non-blocking background build; module_report degrades to outline-only with cache freshness explicit. Example: use project_report before module_report when the target file is unknown."
```

promptSnippet:

```text
"Orient in a project before choosing a file"
```

### read_symbol

description:

```text
"Return one symbol's verbatim source. An outline shows shape, not bodies, and does not satisfy read-before-edit; `read_symbol` and `read_enclosing` return body text and record read coverage. Example: use read_symbol after module_report identifies `parseConfig`."
```

promptSnippet:

```text
"Read one symbol's body instead of the whole file"
```

### read_enclosing

description:

```text
"Return the smallest symbol or callback enclosing a line. An outline shows shape, not bodies, and does not satisfy read-before-edit; `read_symbol` and `read_enclosing` return body text and record read coverage. Example: use read_enclosing after a diagnostic points to line 42."
```

promptSnippet:

```text
"Read the enclosing symbol or callback body for a line"
```

### effective_config

description:

```text
"Explain resolved configuration and provenance. Response is redacted by construction: it contains no environment values, no command arguments beyond the binary, and home-relative paths; a tier-denied LSP decision cannot be lifted by a nearer config. Example: pass `file` to see why its LSP server is selected."
```

promptSnippet:

```text
"Explain resolved configuration"
```

### pi_lens_activate_tools

description:

```text
(none)
```

promptSnippet:

```text
"Activate a situational tool"
```

## TOOL_REGISTRY summary（pi_lens_activate_tools 的目录文本）

```js
TOOL_REGISTRY = [
      {
        name: "ast_grep_search",
        piName: "ast_grep_search",
        mcpName: "pilens_ast_grep_search",
        situational: true,
        summary: "AST-aware structural code search across ~40 languages (ast-grep patterns).",
        disableable: true
      },
      {
        name: "ast_grep_replace",
        piName: "ast_grep_replace",
        mcpName: "pilens_ast_grep_replace",
        situational: true,
        summary: "AST-aware structural code rewrite/refactor (ast-grep patterns).",
        disableable: true
      },
      {
        name: "ast_grep_outline",
        piName: "ast_grep_outline",
        mcpName: void 0,
        situational: true,
        summary: "Syntax-only file/dir structure (symbols/imports/exports/members) via ast-grep outline \u2014 no index/LSP.",
        disableable: true
      },
      {
        name: "lsp_navigation",
        piName: "lsp_navigation",
        mcpName: "pilens_lsp_navigation",
        situational: true,
        summary: "IDE-style LSP navigation: definition, references, implementation, rename, call hierarchy.",
        disableable: true
      },
      {
        name: "lens_diagnostics",
        piName: "lens_diagnostics",
        mcpName: "pilens_diagnostics",
        disableable: true
      },
      {
        name: "lens_diagnostic_mark",
        piName: "lens_diagnostic_mark",
        mcpName: void 0,
        situational: true,
        summary: "Record a disposition for a diagnostic: false-positive / suppress (inline ignore comment) / defer (this session) / flagged (to fix).",
        disableable: true
      },
      {
        name: "symbol_search",
        piName: "symbol_search",
        mcpName: "pilens_symbol_search",
        disableable: true
      },
      {
        name: "module_report",
        piName: "module_report",
        mcpName: "pilens_module_report",
        disableable: true
      },
      {
        name: "project_report",
        piName: "project_report",
        mcpName: "pilens_project_report",
        disableable: true
      },
      {
        name: "read_symbol",
        piName: "read_symbol",
        mcpName: "pilens_read_symbol",
        disableable: true
      },
      {
        name: "read_enclosing",
        piName: "read_enclosing",
        mcpName: "pilens_read_enclosing",
        disableable: true
      },
      {
        name: "effective_config",
        piName: "effective_config",
        mcpName: "pilens_effective_config",
        disableable: true
      },
      {
        name: "pi_lens_activate_tools",
        piName: "pi_lens_activate_tools",
        mcpName: void 0,
        disableable: false
      },
      {
        name: "analyze",
```
