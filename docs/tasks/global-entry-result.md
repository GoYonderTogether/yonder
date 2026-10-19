# 全局入口与开发技能实施记录

## 用户批准范围

单一正式macOS服务；任意目录裸yonder进入常驻会话并看到已有历史；保留独立任务入口、隔离开发home、既有update/版本目录；发行完整skill-creator及可选开发技能，所有默认agent可发现、正文按需加载。用户可选择其他开发方式，不创建强制平台。

## 实现

- CLI复用原生installedService读取正式home，无需shell注入或修改开发目录；明确home参数/环境/当前有效home优先。裸TTY入口选择实际CLI渠道，进入时观察声明main绑定的现有main会话；发送继续原绑定，未创建第二内核。
- 原CLI管理命令和显式chat/预设任务保留。缺初始化时给既有init/login/service install步骤，不悄悄启动第二个服务。更新沿原标签构建/current切换/launchd，不另造安装或更新器。
- skills/内含完整skill-creator资源与Apache许可，仅适配默认Yonder保存目录；来源说明记THIRD_PARTY_NOTICES.md。新yonder-development建议<home>/development/<name>、独立Git与用户指定目录，官方修改走常规PR，开发用隔离home/自身凭据，正式不引用开发目录。
- 内置目录是原发现器最后来源，workspace/home/plugin可覆盖，显式skills过滤仍有效。需要对当前机器已有白名单补选两项；不强制未来配置、不把正文写入SYSTEM.md。

## 验证与问题

- 原始复制两份skill的quick_validate通过；本机Python缺PyYAML，验证借用已装Ruby YAML解析，不安装依赖。之后只适配默认输出路径和开发技能错误的versions/current描述；运行上游Python辅助脚本仍须满足其PyYAML依赖，不能声称系统Python开箱具备。
- 构建首轮发现optional channel赋undefined及测试环境变量推断两处类型错误，按实际值存在再赋值/正确ProcessEnv类型修复，不用断言或放宽strict。
- 最新检查、正式独立安装、唯一进程和实际终端效果在完成后追加。


## 源码检查结果

候选版本0.1.2026101902。build/typecheck通过；最新整仓34文件143/143通过、0失败0跳过，日志/tmp/yonder-global-full-final.log；lint0错误/55warnings/1info。新增上游SVG资产最初触发无title错误，补实际title后通过，未禁用规则。补全检查初次142通过1失败（不隔离home），修为明确临时home后最终整仓通过。当前机器普通Python缺PyYAML的可选辅助脚本依赖事实保留，不以运行时TS技能加载通过代替脚本依赖安装。


## 独立日用安装验收

- 经既有yonder update从GitHub tag v0.1.2026101902独立clone/npm ci/build/doctor/current切换/service install完成，无开发目录运行、无OAuth复制。程序真实路径~/.yonder-harness/versions/0.1.2026101902，无.git；commit65fa4dba6395017db21940eacaa64d6ce1c91552。没有创建本版本GitHub正式Release，源码tag和日用安装不冒充Release发布。
- 清除YONDER_HOME后，在项目目录运行全局yonder version/service info正确发现生产home；service ready=true、PID19108。进程核对只发现一个生产backend。
- 实际PTY执行全局裸yonder，无参数、无home环境：先连接cli，立即显示main/#2/Luna及既有飞书历史；尚未发送消息、未调用模型。Ctrl+D仅退出客户端，服务保持ready。真实终端输出见本次工具记录，未伪造截图。
- 当前main/maintainer已有显式skill白名单补选skill-creator/yonder-development；operator默认全选无需改。三者真实skills查询均selected/indexed=true、source=builtin、issues0。main选择channel-feishu.conversation（CLI输入不会读取飞书背景）。doctor通过，配置修改前备份.pre-global1902。移除本轮验收专用control-f-client/control-f-steer绑定，历史保留。
- update同版本返回updated=false，不重装；版本/home/进程检查不代表首次陌生用户全新系统安装、真实客户端艾特或模型旧问候语义判断已验收。既有F矩阵未测继续保留。
