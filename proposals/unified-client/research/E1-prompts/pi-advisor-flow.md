# pi-advisor-flow — 注入模型的提示词原文

- 包: `pi-advisor-flow` 0.14.3
- License: MIT (Copyright (c) 2025 Philip Brembeck) — `/Users/zoran/.pi/agent/npm/node_modules/pi-advisor-flow/LICENSE`
- 仓库: https://github.com/philipbrembeck/pi-advisor
- 来源: `/Users/zoran/.pi/agent/npm/node_modules/pi-advisor-flow/dist/index.js`（bundle）`pi.registerTool({...})` 的 description/promptSnippet/promptGuidelines
- 注入方式: 两个工具（`ask_advisor`、`record_advisor_outcome`）的 description + snippet + guidelines 进系统提示词；另注册 `/advisor`、`/advisor-manual`、`/advisor-models`、`/advisor-stats`、`/advisor-settings`、`/advisor-off` 命令，并用 `setStatus("advisor-scout"/"advisor-manual"/"advisor-usage", …)` 写底栏；`before_agent_start` + `tool_call`/`tool_result` 钩子做 loop-gate（`sendAutomaticGateCall` 会主动发一条 "Automatic Advisor loop review" 消息）

## ask_advisor

```ts
name: "ask_advisor",
    outputSchema: advisorOutputSchema,
```

## record_advisor_outcome

```ts
name: "record_advisor_outcome",
```
