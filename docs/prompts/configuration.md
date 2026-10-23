# 配置提示词长度与段落

内置正文默认完整装入。短上下文本地模型可在 agent.yaml 的 defaults 或某个 profile 下配置，也可直接写在 presets/<id>.yaml，插件贡献的 Profile 使用相同字段。模型仍用已配置的真实 provider/model，不按名字自动裁剪。

## 只保留少量正文

以下是 profile 配置片段（沿用该 Agent 的真实模型与权限）：

```yaml
profiles:
  local:
    prompt:
      sections: [framework, runtime.delivery]
      overrides:
        framework: >-
          You are an assistant on the user's computer.
          Complete the authorized task, check the result, and state what remains unknown.
    contexts: []
    skills: []
    tools:
      offer: [read, write, edit, bash]
      search: []
    instructions: ""
```

contexts: [] 关闭所选的角色/插件上下文，不会删除 SOUL.md/AGENTS.md 文件；skills: [] 关闭 skill 索引，不会卸载技能。工具白名单仍先受能力限制，列出 write 不会赋予只读配置写入能力。有专门需要时再加所需工具，不必把所有插件 schema 常驻给小模型。

## 全自定义内置正文

```yaml
prompt:
  sections: []
contexts: []
skills: []
instructions: >-
  Help with the user's current task. Use only the available tools and authorized files.
  Return the result directly and state any blocker.
```

sections: [] 关闭全部 Yonder 内置正文，连 framework 导航也关闭。instructions 是已有的尾部自定义文字；清空它则没有这一段。实际用户输入、turn 来源/身份/路径元数据与原生运行计时/恢复事实仍保留，历史上下文不会因此清空。工具和插件钩子仍按配置运行；这不是越权开关，也不保证关闭投递说明后任意模型都能正确发消息。

## 只改一句或一段

```yaml
prompt:
  overrides:
    common.writing: >-
      Reply in natural Chinese. Lead with the answer and explain as fully as requested.
      Use prose for conversation and lists for actual steps or comparisons.
    resident.growth: ""
```

未写 sections 保留默认全量顺序。上例替换整个 common.writing 段、关闭 resident.growth；其他段落沿用默认。希望只改段内某句时，将该段正文复制到 overrides 再编辑该句。支持字面文本，不读取任意路径、不执行代码、不替换 ${...}。角色正文可直接编辑工作区 SOUL.md/AGENTS.md，空文件保持为空，不回填模板。

## 继承和校验

prompt 的 sections 与 overrides 分别继承 defaults。profile 写 sections 时整表替换；写 overrides 时整张替换表替换，`overrides: {}` 可清除从 defaults 继承的替换。替换只影响被选择的段，不能把未选择的段偷偷加回来。空字符串去掉对应段。顺序取 sections 列表，重复与未知 id 拒绝加载，错误重载保留旧有效配置。

resident.* 只对常驻身份生效，cli 只在有 exec 时生效；配置替换不绕过这两条条件。修改按现有运行快照在下一轮使用。官方模板只影响初始文件，不覆盖已有个体设置。

## 稳定段落 id

`framework` 是默认短运行导航；`tool-discovery` 是由实际有效工具生成的按需发现目录与使用说明，也可替换或关闭。其余 id 如下，静态正文只有 [content.ts](../../packages/core/src/prompt/content.ts) 一份，id 是配置接口，不随标题翻译更名。

- `common.identity`
- `common.work`
- `common.updates`
- `common.writing`
- `common.visuals`
- `common.facts`
- `common.autonomy`
- `common.authority`
- `common.voice`
- `common.assets`
- `resident.identity`
- `resident.continuity`
- `resident.relationships`
- `resident.initiative`
- `resident.work`
- `resident.growth`
- `runtime.identity`
- `runtime.events`
- `runtime.delivery`
- `runtime.environment`
- `runtime.capabilities`
- `runtime.services`
- `runtime.media`
- `runtime.delegation`
- `runtime.background`
- `cli`

分组：common 是共同做事与表达；resident 是常驻身份/关系；runtime 是事件、投递、本机环境、插件、子任务和进程；cli 是管理命令导航。精确内容和原稿逐项去向见 [分层说明](README.md)。
