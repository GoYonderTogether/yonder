# X2 MCP客户端结果

2026-10-19，已实现并完成本地真实协议验证，待主路整合发行。仅修改plugins/mcp-client/**与本文件，没有切分支、提交或推送。

## 变化与注册

独立包`@yonder/plugin-mcp-client`，插件id `mcp-client`；工具 `mcp-client_stdio`、`mcp-client_http`；可选turn上下文 `mcp-instructions`；生命周期trigger `mcp-cleanup`。新增直接依赖为已安装的官方`@modelcontextprotocol/sdk`精确1.32.1、既有`typebox`1.3.27、`@yonder/sdk`，无需新增共享SDK API。主路需将包加入根项目引用/发行清单并更新lock和版本。

真实SDK stdio/StreamableHTTP/SSE传输，声明server与工具显式connect两种入口；连接按session隔离、懒连接、传输错误失效、下次请求重连，不自动重放失败工具。支持状态、断开、忘记session覆盖配置，工具发现/调用、资源及模板列取、prompt列取、server instructions。分页cursor原样沿用；外部schema仅在tools请求返回，通用call保留server、原name与arguments，不预载外部工具入模型schema。

connect显式配置支持session临时或persistent（持久到插件data，绑定创建session，重启后懒恢复）。配置中的server供各session按选择使用；连接本身不共享。session.close/stop/显式disconnect清连接和stdio子进程。HTTP通用工具静态能力read/write/message/network，stdio为read/write/message/exec；这是未知外部工具副作用的保守边界，readonly不能借MCP越权。stdio拒绝远程执行环境并默认使用调用env.cwd。

server instructions只有选择mcp-instructions时放turn上下文，已连接服务才呈现，不在render启动服务；每条按server标源并明确外部资料不是系统授权。prompt和资源沿工具结果返回。凭据只使用envCredentials/headerCredentials中的既有credentials引用，不回显凭据；stderr只排空不进日志，结果/错误/上下文对实际解析secret及JSON转义脱敏。HTTP URL不接收userinfo/query/fragment，以credential headers传认证。

## 实际检查

- `./node_modules/.bin/tsc -b plugins/mcp-client`：通过（首次检查2处凭据key可选类型与SDK exactOptionalPropertyTypes兼容错误，已修复后通过）。
- `./node_modules/.bin/biome check --write plugins/mcp-client/src/index.ts`：通过，最终无warning/error；早期5个非空断言warning已清除。
- `node plugins/mcp-client/test/integration.mjs`：通过。独立真实官方SDK server三种传输握手、工具JSON schema发现、read_file读取真实仓库package.json、资源读取、prompt读取、instructions来源、持久配置落盘/重新setup恢复、session隔离、readonly拒绝、实际stdio进程终止后重新连接、AbortSignal取消、session close、stop后实际PID不存在。

本地测试使用真实协议server与真实文件，不使用假模型；插件注册API的最小收集器只承载测试调用，不替代MCP网络/进程通信。没有执行全仓检查、日用安装或真实外网服务任务，这些归主路整合。

## 问题与未测

- OAuth SDK真实401/待授权失败会返回诊断；本插件尚未提供交互OAuth provider/callback UI和token持久化，不复制其他客户端账号、不承诺免授权。已有合法bearer可通过credential header使用。
- 未测：真实需凭据的外网MCP服务、真实OAuth授权流、真实模型自行选择发现/调用工具、远程HTTP断网/会话过期组合。HTTP/SSE仅本机SDK服务真实验证；stdio进程丢失重连已有实证。
- 已连接服务的instructions可通过所选turn上下文呈现；启动时不会主动连全部配置服务。状态及发现同样走保守工具能力，不额外开放readonly代理入口。

## 标准媒体结果映射补齐（同日主路复核）

修复标准MCP媒体内容直接JSON.stringify导致base64挤入文字上下文的缺口：ToolResult content中的image转Yonder ToolResult.images，正文只留mime/bytes/imageIndex；audio、嵌入resource blob与readResource contents blob保存插件data/artifacts并返回真实Attachment（file URI、mime、bytes），正文保留原source/远端resource URI及本地artifact元数据，不保留data/blob。prompt messages中的标准content同样映射。普通文本、structuredContent及其他非媒体字段保持原样；没有新增媒体引擎。

新增最小真实协议检查 `node plugins/mcp-client/test/media.mjs`：独立官方SDK stdio server读取仓库现有真实PNG与本机/System/Library/Sounds/Glass.aiff，image/实际audio/嵌入resource/readResource blob经真实客户端往返；确认images及落盘attachments bytes均与源文件完全一致，server/name/resource URI来源、文本和structuredContent保留，正文data/blob消失。检查通过；单包tsc和改动路径Biome通过。未重跑既有三传输矩阵；模型实际看图/播放声音未测，本检查验证的是协议映射与真实文件字节。插件实现至此冻结。

## 实际loader注册名修复（同日主路checkPlugin发现）

保留失败证据：此前真实协议检查直接module.setup到最小collector，没有经过SDK loader注册名校验。主路实际checkPlugin发现原注册名mcp_stdio/mcp_http不带pluginId前缀，被拒绝；因此此前协议PASS不能证明插件可加载。

现统一源码注册、manifest contributes、README、测试调用与本结果的当前名称为`mcp-client_stdio`/`mcp-client_http`，没有改主路统一的1907版本、根或SDK。双包tsc完成后，真实SDK `checkPlugin('plugins/mcp-client')` 返回`[]`。受命名影响的`test/integration.mjs`与`test/media.mjs`重新运行均PASS，保留原协议证据；本次新增的是SDK loader校验通过，仍不冒称正式安装/真实模型自主调用已过。改动路径Biome通过（首次检查暴露原integration import排序与新长名称格式问题，已修复后通过）。
