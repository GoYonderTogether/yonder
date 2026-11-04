# tauri-plugin-yonder-device

Yonder iOS 壳的原生设备能力插件：日历（EventKit）、提醒事项（EventKit）、
通讯录（Contacts）、照片（PhotoKit，仅授权状态）、位置（CoreLocation when-in-use）、
健康（HealthKit 只读，步数 / 睡眠 / 心率，最近 7 天）。

命令经 `plugin:yonder-device|<command>` 从网页调用（`apps/app/src/lib/nativePermissions.ts`）；
能力在 `apps/desktop/src-tauri/capabilities/mobile.json` 里只对远程站点放开。

| 命令 | 参数 | 返回 |
| --- | --- | --- |
| `status` | `{ kind }` | `{ state: "granted" \| "denied" \| "prompt" }` |
| `request` | `{ kind }` | 同上（触发系统弹窗，结果按用户点击回报） |
| `calendar_events` | `{ from, to }`（Unix 秒） | `{ events: [{ id, title, startsAt, endsAt, allDay, calendar }] }` |
| `reminders` | — | `{ reminders: [{ id, title, notes, done, dueAt }] }` |
| `contacts` | — | `{ contacts: [{ id, name, phones, emails }] }` |
| `photos_status` | — | `{ state }`（照片只读授权状态，不读内容） |
| `location` | — | `{ latitude, longitude, accuracy, timestamp }` |
| `health` | — | `{ steps, sleep, heartRate }`，各为 `[{ start, end, value, unit }]`（最近 7 天） |

`kind` 取值：`calendar`、`reminders`、`contacts`、`photos`、`location`、`health`。

Info.plist 用法说明与 HealthKit entitlement 由 `apps/desktop/prepare-ios.mjs` 重放
（`tauri ios init` 每次重新生成工程，gen/ 不入库）。
