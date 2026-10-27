# codex-computer-use-mcp — 注入模型的提示词原文

- 包: `codex-computer-use-mcp` 0.6.2
- License: MIT (Copyright (c) 2026 Thomas Mustier) — `/Users/zoran/.pi/agent/npm/node_modules/codex-computer-use-mcp/LICENSE`
- 仓库: https://github.com/tmustier/codex-computer-use-mcp
- 来源: `/Users/zoran/.pi/agent/npm/node_modules/codex-computer-use-mcp/integrations/pi/index.ts`（`COMPUTER_USE_NAMESPACE`，含 `description` 与 `instructions`）+ `/Users/zoran/.pi/agent/npm/node_modules/codex-computer-use-mcp/dist/tools.js`（`TOOL_METADATA[*].description`）
- 注入方式: 全部工具 `exposure: "codemode"` + `namespace: COMPUTER_USE_NAMESPACE`；namespace 的 `description` 与 `instructions` 进入 codemode 的脚本说明，工具本身不出现在主工具表

## Namespace description / instructions

```ts
export const COMPUTER_USE_NAMESPACE: ToolNamespace = {
  name: "computer_use",
  description: "OpenAI's official signed macOS Computer Use. Call get_app_state for an app before acting on it, run known actions in sequence, then call get_app_state again before deciding the next step.",
  instructions: `Compose these tools in codemode scripts:

const state = await tools.computer_use_get_app_state({ app: "TextEdit" });
text(state.text);
image(state.screenshot);
await tools.computer_use_click({ app: "TextEdit", element_index: "7" });
await tools.computer_use_type_text({ app: "TextEdit", text: "hello" });

get_app_state resolves to { app, text, screenshot }. text is the accessibility tree; after the first inspection it may be a diff, so pass disableDiff: true for a fresh full tree. screenshot is an image block for image(), or null.
Take element_index values from the latest get_app_state text, and inspect again after acting.
Calls run one at a time, in the order the script makes them.
list_apps resolves to the official text inventory. A failed call rejects with the official error text.`,
};
```

## 每个工具的 description（TOOL_METADATA）

```js
export const TOOL_METADATA = {
    list_apps: {
        description: "List the apps on this computer. Returns the set of apps that are currently running, as well as any that have been used in the last 14 days, including details on usage frequency",
        annotations: readAnnotations,
    },
    get_app_state: {
        description: "Start an app use session if needed, then get the state of the app's key window and return a screenshot and accessibility tree. This must be called once per assistant turn before interacting with the app",
        annotations: readAnnotations,
    },
    click: {
        description: "Click an element by index or pixel coordinates from screenshot",
        annotations: actionAnnotations,
    },
    perform_secondary_action: {
        description: "Invoke a secondary accessibility action exposed by an element",
        annotations: actionAnnotations,
    },
    set_value: {
        description: "Set the value of a settable accessibility element",
        annotations: actionAnnotations,
    },
    select_text: {
        description: "Select text inside a text element, or place the text cursor before or after it. Provide text exactly as it appears in the accessibility tree, including any Markdown formatting. If the text is not unique, provide surrounding prefix or suffix text to disambiguate it.",
        annotations: actionAnnotations,
    },
    scroll: {
        description: "Scroll an element in a direction by a number of pages",
        annotations: actionAnnotations,
    },
    drag: {
        description: "Drag from one point to another using pixel coordinates",
        annotations: actionAnnotations,
    },
    press_key: {
        description: "Press a key or key-combination on the keyboard, including modifier and navigation keys. This supports xdotool's `key` syntax, for example `a`, `Return`, `super+c`, `Up`, or `KP_0`.",
        annotations: actionAnnotations,
    },
    type_text: {
        description: "Type literal text using keyboard input",
        annotations: actionAnnotations,
    },
};
```
