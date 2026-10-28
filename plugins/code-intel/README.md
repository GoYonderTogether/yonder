# Code intelligence

Optional `code-intel_codegraph_explore` uses CodeGraph 1.6.1 in the selected execution environment. Install `@colbymchenry/codegraph@1.6.1` there and run `codegraph init <project>`, then select this plugin for the agent/profile. Use `codegraph sync <project>` after changes. The plugin never starts a watcher or initializes a repository. It requires read and exec capabilities; output is subject to the runtime's output cache.

The tool's parameters and CLI invocation follow [pi-codegraph](https://github.com/HenryQW/pi-harness/tree/main/extensions/pi-codegraph), MIT licensed; the external CodeGraph CLI is independently installed and licensed.

`code-intel_ast_grep_outline` uses `@ast-grep/cli@0.51.0` in the selected execution environment. Install it there and select the tool when syntax-only structure is needed; it does not require an index or LSP. Output uses the runtime cache.

Outline invocation and read handles follow pi-lens 4.4.6 (MIT); see NOTICE.

`code-intel_module_report` calls the pi-lens 4.4.6 MIT-licensed `pi-lens-mcp` executable installed in the selected execution environment (including its runtime dependencies). It accepts `path`, optional `focus`, `view` (`compact`, `summary`, `default`), and `blastRadius`; default is compact. A cold graph provides a syntax outline with explicit graph freshness; heuristic callback/risk details are distinguished by backend provenance. Output uses the runtime tool cache and truncation. Source: https://github.com/apmantza/pi-lens.
