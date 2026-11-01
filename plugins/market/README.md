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

- `market_search`：`q`、`kind`、`category`、`city`、`min`、`max`、`sort`、`limit`（1–50，默认 10）、`cursor`；可传 `sellerId`（账号 UUID）主动查看小店，或 `mine: true` 配合 `status: active/paused` 分页管理本人发布；active 为在售，paused 为已隐藏（含自动到期），按云端当前时间查询，不依赖客户端在线或后台改状态；回 `{items, nextCursor?}`。可见性由云端按主人身份校验；小店直访不受 discoverable 发现开关限制。
- `market_get`：`id`；`includeInquiries` 只对自己的发布生效，额外回 `{inquiries}`。
- `market_publish`：`action` create/update/pause/resume/delete。全部 action 要求 `ownerApproved: true`；false 回 `{ "ok": false, "error": "approval_required" }`，缺失则参数校验拒绝，均不调云端。create 先本地校验 kind/category/title/description/price；`location` 可不传（云端缺省空），不自动填城市。
- listing 可附 `visibility: public/friends/private`（缺省 public；friends 要求互为好友）、`expiresAt`（未来 UTC 毫秒整数或 null 长期）、`coordinates: {latitude,longitude}` 或 null。坐标仅可来自主人明确提供的数据，不主动定位；云端约整至 3 位小数。update 未传字段保留，null 清除到期时间/定位。恢复过期发布应先更新有效期；resume 不自动续期。delete 是本人软删除，接受云端 204 空响应并回 `{ok:true,id,deleted:true}`；既有询问沟通保留。
- `market_inquire`：list/read 直接读；send/reply 要求 `ownerApproved: true`。
- `market_watch`：create/list/update/delete/check。`check` 只返回云端没提示过的新匹配（seenIds 在服务端）。

云端错误码按契约 §19.2 原样回 `{ "ok": false, "error": "<code>" }`，不抛异常。

使用小店/本人状态筛选、带新增范围/有效期/定位字段的写入或删除前，先读取 `GET /api/market/capabilities`，必须明确返回 `listingPolicy: true` 与 `sellerShops: true`。旧云端 404、缺字段或 false 均回 `capability_unavailable`，不发实际查询/修改，防止旧服务静默忽略隐私字段。旧式普通搜索及只改价格等调用仍兼容。

## 找东西排程

`create`/`update` 之后插件按 `frequency`（hourly/daily；manual 不排程）在自己的进程里计时，到点调 `POST /watch-tasks/:id/check`；有新匹配时把卡片写进创建者 Agent 开着的主对话（`sessions.notify`），只通知主人，不联系卖家。`list` 以云端为准重建本地排程，本地状态存在插件 data 目录的 `watch.json`。

插件不创建 cron 作业（spec/15 不允许插件自建作业），所以排程不出现在 `cron list`，插件未加载时不检查。

## 视图

`market.panel`（rail，session）列「我的发布」「收到的询问（未读数）」「找东西任务」，数据来自既有接口，不另设后端。

## 测试

`npx vitest run plugins/market` 用 `node:http` 起本地假云端，覆盖每个工具、未确认被拒、缺凭据与 watch 去重。
