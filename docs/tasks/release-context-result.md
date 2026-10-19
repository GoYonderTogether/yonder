# E2 可升级上下文结果

2026-10-19；本分路实现完成，主路负责注册与实际配置选用。未提交。

- `plugins/channel-github/src/releases.ts`：复用既有Release轮询、批准作者、正式发布/tag及源URL校验。每次成功轮询筛选最高精确版本，首次接收基线也缓存；与既有ID游标写入同一插件数据文件。版本三个数字段使用BigInt比较，避免字典序、浮点精度或过旧候选误报。保留原事件接收基线行为。
- `plugins/channel-github/src/availability.ts`：`releaseAvailability(() => Iterable<Releases>, currentVersion)`，贡献ID `channel-github.release-availability`，placement `turn`。只展示严格高于当前软件版本的缓存；含repository/releaseId/tag/version/url/author，明确外部数据、来自上次成功轮询且没有执行升级。不读取Release正文，不联网、不修改system、不导入pi。
- SDK当前没有运行软件版本。交由主路补最窄的PluginAPI运行version，由core现有包元数据注入；插件不依赖core，不以插件自身版本冒充host版本。主路负责将channel.releases暴露给注册闭包、manifest contexts声明及配置选用。

## 实际检查

- `npx tsc -b plugins/channel-github`：通过。
- `npx vitest run plugins/channel-github/test/availability.test.ts plugins/channel-github/test/repair.test.ts`：2文件、21通过，0失败/跳过。聚焦覆盖首次基线、不合格作者/draft/prerelease/tag/URL排除、最高版本、外部标记与正文隔离、相等/过旧抑制、render不联网及超安全整数版本比较；既有Release/更新检查回归。
- 对本分路三个TS文件执行Biome：通过，无warning。

## 边界与未测

重启后等待本进程第一次成功轮询才提供信息；不直接恢复磁盘元数据为有效建议，以免旧批准配置绕过现行批准校验。后续轮询网络失败保留本进程上次成功元数据，文案明确其来源时间语义。首次基线只建立缓存，不把既有Release发成新事件。

未操作正式home、真实GitHub/模型/launchd、外部通知或发行更新。实际上下文加载与配置选用由主路接线验证；这些源码检查不等于正式安装验收。
