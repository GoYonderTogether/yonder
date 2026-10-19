# 硅基流动媒体接入

2026-10-19用户指定由一个agent实现，优先免费模型，不做2元视频生成；接口复用开源和官方协议。功能以spec/11 §9、D38为准。

## 路径与分工

- Sol：plugins/media-tools/及siliconflow-media-result.md，完整SDK工具/manifest/来源/契约检查。
- 主路：spec/11、decisions及本任务冻结；根package/workspace/lock/tsconfig必要打包接线；正式配置元数据/自动化库引用核实；仅免费真实验证及总结果。
- 不动core/SDK/CLI，不新增skill，不自动安装/发版，不接付费视频。原有.claude/及无关文件不碰。

## 实施与验收

1. 已核实Kolors官方控制台¥0/图片，免费额度L0 2IPM/400IPD；ASR SenseVoiceSmall同次已核实¥0；TTS已核价收费不调用；使用现有自动化凭据，不在浏览器提取密钥。
2. 冻结后实现image_generate，ASR/TTS按真实免费证据追加范围；视频仅报告可用免费API证据。
3. 插件契约/类型/必要聚焦检查；经可信子进程注入凭据做一次免费真实调用，保存实际图片。已有真实模型如需接线只做一个最小场景，不跑全功能矩阵。

## 结果与问题

进行中；未测不得写成已通过。
