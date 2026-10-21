# Sources

- Tencent protocol SDK: `@tencent-connect/qqbot-nodejs@1.0.4`, MIT, https://github.com/tencent-connect/qqbot-nodejs. Used as an npm dependency, not vendored or patched. Handles token refresh, WebSocket/RESUME and message API. Yonder uses current api.bot.qq.com base URLs and supplies persisted sequential reply msg_seq through the public send API.
- Tencent QR binding connector: `@tencent-connect/qqbot-connector@1.2.0`, https://www.npmjs.com/package/@tencent-connect/qqbot-connector. Used through its published startQrConnect API as documented in its distributed README. The published package metadata declares UNLICENSED; its code is not copied, modified, relicensed or bundled into Yonder source. Upstream describes the default QR integration as a third-party bot and provides qq_bot_api@tencent.com for named integrations.
- QQ official API documentation: https://bot.q.qq.com/wiki/develop/api-v2/ (checked 2026-10-21).
- Architecture references: Hermes cf4f3a7396814ffcaef69d9af09f7cfdade3ddbe, plugins/platforms/qqbot; tencent-connect/openclaw-qqbot 89988812442583bf47c34b89f9abf5fd4b85df0b. No framework implementation is copied.
