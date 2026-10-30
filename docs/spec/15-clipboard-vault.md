# 15 AI 剪贴板与秘密库（D53）

目标：程序按引用搬运字节，模型不转写；sealed 字节只经系统 Keychain 和受信任消费者。不扩展模型/会话存储或第二审批系统。此设计由 Track A 任务明确授权；未实现/未验证子目标见 verification 与 status。

## 1. 对象与权限

官方 `clipboard` 插件仅依赖 @yonder/sdk。安装和 setup 只注册、不读库/编译/写文件。工具受既有 capabilities 与选中插件控制；额外数据 ACL 由插件配置 `grants` 给出 exact `agent`（可 null）+`profile`，不支持 wildcard。每个 grant 包含 `sealed`、`readRoots`、`writeRoots`、`destinations`（固定消费者 id）、`messageTargets`。缺省无 grant。

每个 opaque UUID handle 独立归 `session/agent/profile`，含 class=open|sealed、来源 type/ref、时间、byteLength、sha256、expiresAt。全局 maxBytes 默认 256KiB（sealed 64KiB）、ttlSeconds 默认 3600，正整数且有上限；只读同作用域，不能猜 id 跨会话。sha256 是指纹而非保密措施，不适合低熵秘密的安全承诺。

open blob 存插件私有 `.yonder/plugins/clipboard/blobs/<sha256>`（0700/0600）；clip 元数据分别存 JSON，独立原子 create，不保存会话转录。sealed 内容只存 Keychain，service 按插件 data 路径散列隔离，account=handle。内核不持有 master secret。Keychain helper 显式准备时编译一次，不在 setup/普通未授权调用里自动安装；失败只给安全码，绝不回显子进程错误或原文。仅支持 node:local，远程 env 拒绝。

每次工具调用/捕获均先追加 `clipboard.audit` intent，再执行并追加 completed/failed，包含操作、scope、handle/目的地类别和安全码，不含字节。CLI 捕获先写私有 metadata audit journal，插件下一次授权调用导入事件账本并删除已导入文件；stable audit id 支持识别重复，不虚构跨存储事务。掉电可能留下 intent/孤立内核 item，清理见文档；不声称 exactly-once。

Windows 对应平台契约见 ../windows.md：sealed 使用系统 DPAPI CurrentUser 加密存储，私有路径校验当前用户 ACL；不依赖 macOS Keychain，也不将明文写文件。Mac Keychain 契约不变。

## 2. 工具与来源

- `clipboard_copy({from,class?,ttlSeconds?})`：from=message(eventId)、file(path,start?,end?)、tool(transcriptId)；file 范围是字节、end 排他，不自动 trim/转码。消息按 D51 **同来源 conversation** 查询 message.in，仅复制 data.text；tool 只读当前 session 的原生 transcript tool 文本，不复制它到独立历史。message/tool 只允许 open（原文已入账本/模型，不可事后变 sealed）。file 可 sealed，需显式 grant；来源 realpath 必须在 readRoots 内，拒绝 symlink/非普通文件/超限。
- `clipboard_capture({ttlSeconds?})`：创建绑定当前 scope 的一次性 capture ticket，返回本地隐藏 TTY 命令。`yonder-clipboard capture --data <path> --ticket <id>` 不接受明文参数/环境/重定向，仅人机 TTY，不回显；取消不存。capture ticket 在兑现前原子领取，失败不重放；成功产生同 handle 的 sealed clip。不新增能向模型返回明文的 getter。
- `clipboard_paste({handle,to})`：to.kind=file(path)、consumer(id)、message(target)、vault。sealed 必须显式 grant；message 永远拒绝 sealed。
- `clipboard_list({})`：当前 scope 未过期元数据，不返回原文。
- `clipboard_drop({handle})`：删自己 Keychain item/元数据；保留历史 audit，共享 open blob 保留，退役作用域后离线清理。不删除或改写事件历史。过期对象不能使用，但可以 drop。

浏览器 element capture/fill、Feishu 私密录入在可信 adapter/入站前秘密分流未具备前 **不注册**，不得用明文 DOM、模型参数或渠道聊天实现替身。

## 3. 类型化目的地

- file：仅 writeRoots 下现存真实父目录，create-only（O_EXCL|O_NOFOLLOW），sealed 0600，open 0600；不覆盖。写入 fsync，读回验证 length/hash。失败删除本次创建的文件；取消亦清理，绝不删原文件。使用本机文件 API，不承诺防同 OS 用户恶意目录交换的沙箱隔离。
- consumer：模型只能选配置 id；配置决定 `child`（固定绝对 file/args/cwd/variable，secret 只进该子进程 env；不继承宿主凭据，不回传 stdout/stderr）或 `http`（固定 HTTPS URL/method、header 或 body；明确 grant，拒绝重定向，返回 status/ok，不返回正文/header）。不得接受任意命令、URL 或变量。HTTP 只接受 2xx 成功；网络未知不重试，返回安全失败码。测试使用隔离 loopback TLS 服务，不放宽产品 HTTPS 规则。
- message：open UTF-8 通过 SDK messages.send，target 必须在 grant.messageTargets 且通过原有核心能力判定；结果/ledger 不重复返回正文。
- vault：将 open 原字节存为新 sealed handle；不覆盖现有 item；open 原来源/blob 不被追溯清除。sealed 无需重复拷贝。不会写 auth.json；D50 的 credentials.set 和 D51 的 sources 不变。

## 4. 防泄漏与边界

默认 deny；sealed operation 需选中 `clipboard` 且配置 grant。精确值替换由 `clipboard-redact` afterTool 与 beforeSend 实现，选中 profile 的每个工具结果（包括 read/bash）在进入转录前过滤；图片/附件不作为安全文本，sealed 值存在时结果附件/图片不返回。持久已记录 sealed 对象用于重启后重建精确匹配，过期仍遮罩，drop 后不再保证遮罩。所有对象的值都参与当前已授权 profile 的遮罩，以防跨 session 泄漏。库不可读时 fail closed，不把未过滤结果交模型/渠道。

SDK 新增可选 `Hook.beforeSend(message: OutMessage, owner?: ExecutionOwner): HookResult<{message: OutMessage}>`。核心只对该会话选中插件执行，发送前、attempt/ledger 前过滤。带 beforeSend 的 profile 将每条流式消息缓存到 message_end 再过滤；保留逐消息边界与 NO_REPLY，不缓冲整次运行。不修改 pi 或把具体 vault 写进核心。无会话的插件发送不隐式借其他 profile 权限。

精确替换不能识别编码、多模态或同一用户的 shell 绕过；原生 process 结果也过滤，但底层 raw shell log 不属于保密存储，秘密应使用只提供必要 clipboard/consumer 工具的专用 profile。拥有 exec 的模型可能直接读 pasted file、Keychain helper、发网络；本插件不是 OS 沙箱。sealed 文件是明确泄密给受信任目标，调用方必须信任该目标。关闭插件/漏选钩子、drop 后旧副本、内存/交换区、恶意同用户进程、此前已有明文历史不在保证内；不宣称“模型绝对永不知晓”。

## 5. 验收

实际 Keychain 随机字节集成；权限默认拒绝、错误 session/profile、过期/超限、目的地 allowlist、symlink/create-only、hash、取消、重启遮罩、错误不含秘密。真实 Luna 复制 40k CJK/emoji/伪闭合标签原消息字节一致，工具参数没有原文；sealed capture/file→file，transcript/ledger/logs 精确搜索无值。模型凭据不可用明确未测。浏览器/Feishu/签名更新/锁屏独立列未验收。
