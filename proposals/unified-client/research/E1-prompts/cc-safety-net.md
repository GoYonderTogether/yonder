> 证据材料，结论已并入 [agent-parity.md](../../agent-parity.md)

# cc-safety-net — 注入模型的提示词原文

- 包: `cc-safety-net` 2.7.0
- License: MIT (Copyright (c) 2026 J Liew) — `/Users/zoran/.pi/agent/npm/node_modules/cc-safety-net/LICENSE`
- 仓库: https://github.com/kenryu42/cc-safety-net
- 来源: `/Users/zoran/.pi/agent/npm/node_modules/cc-safety-net/dist/pi/index.js`
- 注入方式: **常驻不注入任何系统提示词**。`kt(pi)` = `pi.on("tool_call", handler)`，在工具调用前按 `cc-safety-net` 规则拦截 bash 命令与敏感文件读取，返回 `{ block: true, reason: ... }`；唯一模型可见文本来自 `/cc-safety-net` 命令，它把 README 的 `# CC Safety Net` 起整段拼上用户请求后作为 user message 发送

## 命令 description 与拼接模板

```js
var o="cc-safety-net",r="Operate CC Safety Net: explain blocks, rules, integrations, diagnostics",s="Help me with CC Safety Net.";
function t(e){e.registerCommand(o,{description:r,handler:async(n,i)=>{e.sendUserMessage(a(n),i.isIdle()?void 0:{deliverAs:"followUp"})}})}
function a(e){return`${le.slice(le.indexOf("# CC Safety Net")).trimEnd()}

## User request

${e.trim()||s}`}
```

（`le` = 打包进 dist 的 README.md 全文，运行时按 `# CC Safety Net` 截取；本文件不复制 README 正文，避免与上游漂移。）
