# Code intelligence

Optional `code-intel_codegraph_explore` uses CodeGraph 1.6.1 in the selected execution environment. Install `@colbymchenry/codegraph@1.6.1` there and run `codegraph init <project>`, then select this plugin for the agent/profile. Use `codegraph sync <project>` after changes. The plugin never starts a watcher or initializes a repository. It requires read and exec capabilities; output is subject to the runtime's output cache.

The tool's parameters and CLI invocation follow [pi-codegraph](https://github.com/HenryQW/pi-harness/tree/main/extensions/pi-codegraph), MIT licensed; the external CodeGraph CLI is independently installed and licensed.

`code-intel_ast_grep_outline` uses `@ast-grep/cli@0.51.0` in the selected execution environment. Install it there and select the tool when syntax-only structure is needed; it does not require an index or LSP. Output uses the runtime cache.

Outline invocation and read handles follow pi-lens 4.4.6 (MIT); see NOTICE.

`code-intel_module_report` calls the pi-lens 4.4.6 MIT-licensed `pi-lens-mcp` executable installed in the selected execution environment (including its runtime dependencies). It accepts `path`, optional `focus`, `view` (`compact`, `summary`, `default`), and `blastRadius`; default is compact. A cold graph provides a syntax outline with explicit graph freshness; heuristic callback/risk details are distinguished by backend provenance. Output uses the runtime tool cache and truncation. Source: https://github.com/apmantza/pi-lens.

For a reproducible standalone MCP installation in the execution environment, run `npm install --prefix <directory> --ignore-scripts pi-lens@4.4.6 @earendil-works/pi-coding-agent@1.3.0 @earendil-works/pi-tui@1.3.0 typebox@1.3.27`, and add `<directory>/node_modules/.bin` to its PATH. pi-lens declares these host packages as optional peers, but its MCP entry requires them in this version.

`code-intel_read_symbol` calls pi-lens 4.4.6 MCP with `file`, `symbol` (including a `module_report` callback handle or dotted class member), and optional `kind`. It returns the backend's source and range; its read-guard state is not a Yonder edit prerequisite. The backend may truncate long results before Yonder's output cache sees them.

`code-intel_read_enclosing` runs `pi-lens-mcp` from pi-lens 4.4.6 in the selected execution environment. Install `pi-lens@4.4.6` and its required runtime peers (`@earendil-works/pi-tui@1.3.0`, `@earendil-works/pi-coding-agent@1.3.0`, and `typebox`) in that environment. It reads the smallest enclosing symbol or callback at `path` and 1-based `line`; `kinds`, `maxLines`, `onOversize` (`error`, `slice`, `outline`) and `aroundLine` are optional. Oversized results default to metadata-only errors; slices are explicitly partial. It requires read and exec. pi-lens read coverage is internal to pi-lens and does not satisfy Yonder edit read checks. Runtime output caching applies to the returned MCP result; pi-lens itself limits its response.
