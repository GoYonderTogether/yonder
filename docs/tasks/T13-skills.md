# T13 skill：发现、索引与 `skill_view`

**依据**
- `docs/spec/03-agents.md`（§6 Skill）、`89-96`（system 第 ③ 段）、`60-78`（配置档 `skills`）
- `docs/spec/04-plugins.md`（`skills` 槽）
- `docs/spec/05-security.md`（`skill_view` 不需要能力）
- `docs/spec/09-cli-release.md`（`yonder skills`）

**路径**：`packages/core/src/skills/`、`packages/core/src/tools/`（`skill_view`）、`packages/core/src/prompt/`（只接入第 ③ 段）、`packages/cli/`（`skills` 命令与 `doctor` 的 skill 检查）

**必须**
- 发现：工作区 `skills/`（经执行环境）、home `skills/`、插件登记的目录，递归找 `SKILL.md`；按 03 §6 校验 frontmatter（`yaml@2.9.1`）；同名按来源优先级取前者，记录被遮蔽的。
- 选择：按配置档 `skills` 通配；`disable-model-invocation: true` 不进索引。
- 索引：03 §6 的格式，按 `name` 排序，每次组装提示词时生成；超过 4000 估算 token 时 `doctor` 警告。
- `skill_view({ name, path? })`：返回全文或目录内文件，开头注明目录绝对路径与位置；`path` 越出目录时报错；只能读本配置档选中的 skill。
- `yonder skills`：列出 skill、来源、是否被遮蔽、是否进索引、索引估算 token。

**禁止**：自动生成、合并、删除 skill；把 skill 全文放进 system。

**验收**：工作区 skill 遮蔽同名 home skill；不合法的 skill 不加载并给出原因；索引两次渲染逐字相同；`skills: []` 时无索引；`readonly` 配置档能用 `skill_view`；真实模型：home 里一个 skill 要求回答时附上它规定的标记，模型读取后照做；agent 被要求自己写一个 skill 后，下一次运行的索引里出现它。

## 结果

- 实现工作区、home 与插件目录的递归 skill 发现；按来源优先级处理同名遮蔽，校验 YAML frontmatter，并报告无效 skill。
- 实现配置档通配选择、`disable-model-invocation` 索引过滤、按名称确定性生成 system 索引、字符数除以 4 的 token 估算，以及 `skill_view` 的选中范围与真实路径目录检查。
- `SkillsReport` 提供 skill 来源、遮蔽、选择、索引状态、估算 token 与问题列表；`skill_view` 不声明能力。
- 检查：`npx tsc -p packages/core/tsconfig.json --noEmit`、`npm run build` 均通过；`npx vitest run packages/core/src/skills/skills.test.ts` 通过（1 项，覆盖工作区遮蔽 home、稳定索引、文件读取与越界拒绝）。
- 未执行真实模型与完整验收，留第二轮。

## 问题

（无）

- 主 agent 接线：索引进入 system 第③段，skill_view 注册到运行时，CLI skills/doctor 读取同一报告；全部包构建通过。CLI 错误输出补齐 stderr 与 --json 两路。真实模型读写 skill 留第二轮。
