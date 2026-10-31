# Market

社交云端市场的独立 SDK 插件（id `market`）。只在 `full` 发行包加载，默认不启用。

配置：

```yaml
plugins:
  market:
    endpoint: https://yonderbot.net # 缺省与 channel-card 相同的社交云端
    credential: market # yonder.yaml credentials 里的设备令牌引用
```

`credential` 须解析为 `api_key`；缺凭据时工具返回 `{ "ok": false, "error": "not_signed_in" }`，不发起请求。插件不读取 channel-card 自己的令牌文件。

## 工具

- `market_search`：`q`、`kind`、`category`、`city`、`min`、`max`、`sort`、`limit`（1–50，默认 10）、`cursor`；回 `{items, nextCursor?}`。
- `market_get`：`id`；`includeInquiries` 只对自己的发布生效，额外回 `{inquiries}`。
- `market_publish`：`action` create/update/pause/resume。全部 action 要求 `ownerApproved: true`；缺失或 false 时不调云端，回 `{ "ok": false, "error": "approval_required" }`。create 先本地校验 kind/category/title/description/price/location。
- `market_inquire`：list/read 直接读；send/reply 要求 `ownerApproved: true`。
- `market_watch`：create/list/update/delete/check。`check` 只返回云端没提示过的新匹配（seenIds 在服务端）。

云端错误码按契约 §19.2 原样回 `{ "ok": false, "error": "<code>" }`，不抛异常。

## 找东西排程

`create`/`update` 之后插件按 `frequency`（hourly/daily；manual 不排程）在自己的进程里计时，到点调 `POST /watch-tasks/:id/check`；有新匹配时把卡片写进创建者 Agent 开着的主对话（`sessions.notify`），只通知主人，不联系卖家。`list` 以云端为准重建本地排程，本地状态存在插件 data 目录的 `watch.json`。

插件不创建 cron 作业（spec/15 不允许插件自建作业），所以排程不出现在 `cron list`，插件未加载时不检查。

## 视图

`market.panel`（rail，session）列「我的发布」「收到的询问（未读数）」「找东西任务」，数据来自既有接口，不另设后端。

## 测试

`npx vitest run plugins/market` 用 `node:http` 起本地假云端，覆盖每个工具、未确认被拒、缺凭据与 watch 去重。
