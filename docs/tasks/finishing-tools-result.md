# P3 浏览器、桌面与 Web 收尾结果

日期：2026-10-19。范围按已批准 finishing-plan P3；仅修改 codex-tools/Web 的现有说明与一个现有断言。未改资源生命周期、驱动、权限、配置、规范、共享代码或正式安装；未发布/提交。以下源码插件脚本通过已构建插件的工具 execute 调用真实 bsk/Codex app-server，**不是安装版 Yonder 模型/路由验收**，也不是宿主直接调用 CUA。既有 E04/E05 的安装版模型实证保留，不重复计为本轮结果。

## CUA：跨 run 变量、窗口与菜单

- 根因已确认：`plugins/codex-tools/src/index.ts` 以 Yonder session 为资源键，显式监听 `run.end` 后 unsubscribe/close；README 已写明绑定只在当前 run 保留。原模型可见 JS 描述只写 persistent，未给出此边界，容易让下一 run 继续使用旧 app 变量。spec/11 要求保留上游工具语义，但没有承诺跨 run 保留资源；本轮补齐 status 描述、status 返回的 lifetime 与 JS 描述，明确每个新 run 单入口初始化，再阅读文档。继续按原 run.end 释放，不延长至 session.close、不增加常驻进程。
- 固定脚本 `/tmp/yonder-p3-cua.mjs`：真实 status/getState → 定义 marker → 下一调用读 marker → 只读绑定飞书 → AX → 调用真实插件 run.end 监听 → 新 run getState → typeof marker。最终 **8 次工具调用 / 0 工具错误**，同 run 两次 marker 一致，新 run 返回 undefined。证据 `/tmp/yonder-p3-cua-final.json`。这是实际插件清理行为验证；手动投递监听事件不冒充完整内核 run.end 路由回归。
- 初次脚本 `/tmp/yonder-p3-cua.json` 保留：前五次调用成功，第六次受脚本共用的总 60 秒 AbortSignal 截止而取消，连接按原行为释放。改为已有每调用 timeout 后完成；没有提高产品超时或重试桌面动作。最终单调用耗时约9–18秒，直接 app-server RPC/MCP 宿主本身有可见启动/调用延迟，不能据此归因某个 UI 操作慢。
- 当前真实 getState 发现正在运行的 Feishu（com.electron.lark）；getApp 得到“飞书”窗口及 AX，随后 AX 报无变化。没有点击、激活、发送或读取无关应用。此前 cgWindowNotFound 本次未重现；原始失败仍保留，不能宣称已修复其上游窗口绑定问题。每新 run 重新选择 app 可避免本项目已确认的旧变量失效，但不证明窗口永不丢失。
- 同一 getState 的 browser inventory 仍报 `Missing required Codex turn metadata: session_id, turn_id`，apps inventory 可用；这是当前 app-server CUA 的浏览器宿主上下文限制，继续用默认 BrowserSkill，不伪造 metadata/换桌面驱动。
- 原状态栏 getApp 长等待没有重试。用户此前确认菜单正常的证据不等于 CUA 支持该无普通窗口入口；本轮不能把普通飞书窗口读取成功作为菜单可控证据。菜单路径仍为上游入口未验/历史失败，未做项目猜测性补丁。

## BrowserSkill：七工具真实调用

复用当前 bsk0.3.3/daemon0.3.3，Chrome155、extension0.3.3；当前真实 status=connected、doctor 8项成功，浏览器实例195df83d。使用独立 noFocus Agent Window/session nraa，未借用户页、未改扩展权限或重启 daemon。

固定脚本 `/tmp/yonder-p3-browser.mjs`，逐条 JSON 输入保存在证据中的 args；源码插件数据与产物目录 `/var/folders/hg/8kf929p12wz498k8q4r74kg00000gn/T/yonder-p3-browser-dSJcSG/`，完整 `evidence.json` 为 **31 次工具调用 / 30 次未报错 / 1 次真实失败**。这些是调用结果数，不等于31项测试断言或完整38动作验收。

| 工具 | 本次动作与证据 |
|---|---|
| setup | status（另一次既有 live.mjs）、guide 返回实际连接端口52800、对应实例、官方商店及连接说明；未打开商店。 |
| session | 显式实例创建后台窗口；末尾 stop 返回 closed/cleanup_error=null，再 list 得 requests=[]。 |
| page | 导航真实 httpbin.org/forms/post，再导航 Selenium 官方公开 web-form.html，均 reached=load。 |
| inspect | observe 看到实际控件和值；续页 cursor 观察 GitHub LICENSE；html 读取真实 select option values；PNG截图208215字节、1798×1005（产物 capture-19-0.png）。 |
| interact | httpbin 表单 fill 写入本次验收标识，后续 observe 确认；Tab 按键返回成功（不据此单独宣称焦点已验证）；radio click 后 observe=checked；wheel 返回成功但页面短，未声称滚动距离验证；Selenium select value=2，返回 label=Two 且 observe值=2。未提交表单。 |
| tabs | 创建后台 GitHub Tencent/BrowserSkill LICENSE 页、list确认active=false；select返回该tab；close后list只余自有表单页。 |
| file | GitHub 实际“Download raw file”下载 MIT LICENSE成功，1064字节、text/plain，落盘内容首行MIT License，SHA256 `45426ad9507fe1b922121f5af6a4669096e721980b4426609a4384da410f5114`。Selenium官方表单 input 模式选择此公开许可证文件失败，见下文。 |

上传原始失败：`cdp_failed`、`-32000 Not allowed`，上游 hint 要求核对 Chrome 的 “Allow access to file URLs” 或 request-help；`effect_state=unknown/phase=set_files/reason=set_file_input_failed`。只观察当前表单，未见附件，未改权限、未重试/切 drop、未提交。此结果应记实际权限/上游阻塞，不能用下载成功抵扣上传。要完成上传场景，需要用户按上游引导确认扩展权限后再进行同一获准文件的真实验收；本项目不得自动改扩展权限。

未连接路径：当前扩展确实 connected；本轮未人为关闭用户扩展或改 BSK_HOME 制造断开，故**真实 extension-disconnected→guide→用户连接→恢复未测**。已核对现有实现会区分 cli-missing、daemon-absent、extension-disconnected/connected，并保留原生失败；现有自动检查验证错误/已取消/异地env拒绝等边界，但不以源码或guide在connected时返回替代断开实证。其余借还标签、human-help、iframe/Canvas、全页截图等38动作全集本轮未宣称通过。

## Web 来源与日期边界

- 复用 E05：安装版 session1217 的真实 Tavily search/extract、fetch及1230 native hosted search 来源证据保留；本轮未为已过搜索链重复调用模型/供应商。
- 追源码：Tavily Search/Extract 对供应商 JSON 只检查 results、加 supplier、脱敏/输出限额，保留 `...data` 原字段；没有在本地把表格变 Markdown、重排日期或补日期。因此既有“原生提取表格日期缺失”不能归为本项目日期解析 bug，更不能制造日期补全器。输出达到64KiB仍有既有明确截断标记。
- HTTP HTML Fetch 则实际经过 Readability；markdown 再经过 Turndown，html/text 同样是提取后的 article。它不是原始 HTML 导出，也不能承诺保留表格日期/导航/元数据。本轮在 extract/fetch 模型可见描述与 README 明示这些当前边界，没有新增格式/解析器/回退。
- 原生供应商已省略字段或提取库未纳入文章的字段不提供保真承诺；需要核对原网页细节时用现有 BrowserSkill observe/html（保留来源），不能把搜索摘要/抽取结果当原文全字段。登录页/401/403、JS外壳、二进制和取消仍按现有错误与入口，聚焦检查覆盖。

## 检查与剩余项

- 第一次聚焦检查：3 files / 24 passed / 0 failed / 0 skipped；之后仅补工具可见说明，再运行同三文件仍 **3 files / 24 passed / 0 failed / 0 skipped**。命令：`npx vitest run plugins/codex-tools/src/codex-tools.test.ts plugins/browser-skill/test/plugin.test.ts plugins/web-tools/src/web-tools.test.ts --exclude '**/dist/**'`。
- `npx tsc -b plugins/codex-tools plugins/browser-skill plugins/web-tools` 成功。最终 codex-tools/Web 增量build再次成功。
- 初次 Biome 有1项纯格式错误（新增lifetime长字符串换行），修格式后4个改动TS文件检查通过，0错误；没有放松规则/断言。
- 正式安装未更新；新增模型可见说明尚未在安装版模型新run验证。本轮没有发现需共享core修改的事实。真实上传权限、真实扩展断连恢复、CUA菜单入口/偶发窗口丢失仍按上述具体原因保留未闭合，不宣布整个P3实际场景全通过。
