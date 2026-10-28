# Code intelligence

Optional `code-intel_codegraph_explore` uses CodeGraph 1.6.1 in the selected execution environment. Install `@colbymchenry/codegraph@1.6.1` there and run `codegraph init <project>`, then select this plugin for the agent/profile. Use `codegraph sync <project>` after changes. The plugin never starts a watcher or initializes a repository. It requires read and exec capabilities; output is subject to the runtime's output cache.

The tool's parameters and CLI invocation follow [pi-codegraph](https://github.com/HenryQW/pi-harness/tree/main/extensions/pi-codegraph), MIT licensed; the external CodeGraph CLI is independently installed and licensed.
