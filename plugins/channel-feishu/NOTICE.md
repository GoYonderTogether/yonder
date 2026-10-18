# Sources and licenses

Protocol behavior adapted for the Yonder SDK by Codex; this is not a copy of either upstream runtime.

- OpenClaw, MIT, commit `cafa09e50556e08c2a04a670f16ac815482c5489`, https://github.com/openclaw/openclaw/tree/cafa09e50556e08c2a04a670f16ac815482c5489/extensions/feishu : `src/client.ts`, `monitor.transport.ts` (WebSocket lifecycle), `monitor.account.ts` (event/callback association), `monitor.message-handler.ts` (ingress identity), `send.ts` (message/reply semantics), `post.ts`, `markdown.ts`, `media.ts` (resource/upload/type limits), `streaming-card.ts` (CardKit create, cumulative update, sequence, final close and partial delivery semantics). License preserved as LICENSE.openclaw.
- Hermes Agent, MIT, commit `66605471e9f0b0832abbefaf625ce08e948ca540`, https://github.com/NousResearch/hermes-agent/blob/66605471e9f0b0832abbefaf625ce08e948ca540/plugins/platforms/feishu/adapter.py : admission/self-echo filtering, resources and MIME, persistent original message receipts, Ogg/Opus duration and native media routing, official WebSocket reconnect ownership. License preserved as LICENSE.hermes.
- Official Lark Node SDK `@larksuiteoapi/node-sdk` 1.74.0 owns WebSocket authentication, dispatch and reconnect. https://github.com/larksuite/node-sdk
- Official REST routes: https://open.feishu.cn/document/server-docs/im-v1/message/create , https://open.feishu.cn/document/server-docs/im-v1/message/reply , https://open.feishu.cn/document/server-docs/im-v1/message-resource/get , https://open.feishu.cn/document/cardkit-v1/card-element/content . No vendor API call was executed during implementation.

No OpenClaw/Hermes queue, agent router, office API platform, retry engine, compatibility configuration surface or model runtime is bundled.
