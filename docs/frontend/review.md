# 前端评审记录（Hallmark 静态检查与验证循环）

> 事实文档。Hallmark 是设计工具，**不是本产品的权威规范**；`docs/spec/` 与页面树才是。本文只记录「跑了什么命令、原始结果是什么、哪些需要人判断、哪些没测」，不把未测写成通过，也不宣称已修复。

## 1. 安装与版本

- Hallmark 已在本机安装：`~/.claude/skills/hallmark/`，`SKILL.md` frontmatter `version: 2.0.0`（目录 mtime 2026-10-29 00:22）。
- 本次只使用它的静态 lint 脚本 `scripts/sloplint.mjs`；未使用 theme deal、未用 `--render`、未启动浏览器。

## 2. 原始命令与原始结果

命令（在仓库根执行，证明范围是 app 源码）：

```sh
node ~/.claude/skills/hallmark/scripts/sloplint.mjs apps/app/src --scope app --genre modern-minimal
```

首次运行（基线 `75fbed5eba71`，65 个文件）的**完整原始输出**：

```text
apps/app/src/styles.css
  FAIL 20 :1 no Hallmark stamp on the first non-empty line of any CSS | fix: The stamp comment is line 1 of the CSS; only @charset may precede it
  FAIL 48 :300 colour literal #000 outside tokens (-webkit-mask-image on .ambient) | fix: Lift the value into the token block
  FAIL 48 :301 colour literal #000 outside tokens (mask-image on .ambient)
  WARN 29 :314 blurred orb: filter blur(60px) on the positioned .ambient::before | fix: Delete the wash; a surface is paper or ground, not a light show
  WARN F3 :182 no text-wrap: balance on any display head (2 head rule(s), e.g. .md h1) | fix: Add text-wrap: balance to h1/h2-level heads
apps/app/src/features/social/Connect.tsx
  FAIL 63 :113 middle-dot meta string "1 · 复制提示词 2 · 等待连接" | fix: Line breaks, columns or hairlines; one dot in a byline at most
apps/app/src/features/social/GroupJoin.tsx
  FAIL 63 :46 arrow glued to the label "回到消息 →" | fix: A verb as the label; the link already says it goes somewhere
apps/app/src/features/social/AddFriend.tsx
  REFLEX 28b :138 video without poster | fix: Add a poster frame; guard: below the fold and not the LCP
sloplint: 5 FAIL, 1 REFLEX, 2 WARN across 65 file(s).
```

退出码 1（有 FAIL）。

## 3. 复跑时的事实变化（并行开发，不是我改的）

写文档期间 `apps/app` 有多个并行提交。在 `10fef489cbf1` 复跑同一命令，结果是 **49 FAIL / 1 REFLEX / 2 WARN / 72 文件**。差异原因逐条核对：

| 首跑的项 | 复跑状态 | 原因 |
|---|---|---|
| `styles.css` `.ambient` 的 `#000` ×2 (FAIL 48) | **消失** | 提交 `84271a9`/`10fef48` 删除了 `ui/kit/Aura.tsx` 与 `styles.css` 的 `.ambient` 段；不是本任务修复 |
| `styles.css` blur(60px) (WARN 29) | **消失** | 同上，随 `.ambient::before` 一起删除 |
| `styles.css` 无 stamp (FAIL 20) | **仍在** | 未处理 |
| `md h1` 无 `text-wrap: balance` (WARN F3) | **仍在** | 未处理 |
| Connect / GroupJoin / AddFriend 三项 | **仍在** | 未处理 |
| 新增 `features/settings/NotifySection.tsx` FAIL 10a `transition-[left]` | 新增 | 来自 T-FE-18 的提交 `ba2a975` |
| 新增 `devtools/devtools.css` 无 stamp + 约 40 条 `#48` token 颜色字面量 | 新增 | 来自 `devtools`（`?devtools=1` 才懒加载的演示浮窗），提交在写文档期间 |
| 新增 `devtools/ViewSwitcher.tsx` WARN 29 `backdrop-blur-sm` | 新增 | 同上 |

结论：**本文记录两次数值，不合并成一个数字**。首跑的 5 FAIL / 1 REFLEX / 2 WARN 是任务给定的基线；复跑的 49 FAIL 主要来自 devtools 的令牌块写法，不是本次范围。

## 4. 逐项分类：工具规则 vs 产品问题

### 4.1 工具规则，不是现有产品缺陷

- **`styles.css` / `devtools.css` 缺 Hallmark stamp（FAIL 20）**：这是 Hallmark 对自己产出的文件要求「第 1 行是 stamp」。`apps/app/src/styles.css` 是项目既有样式表，第 1 行是 `@import "@yonder/design/tokens.css"`（`styles.css:1`），有既定的令牌与主题体系（`:6-23` 的 `@theme inline`）。给既有产品样式补 Hallmark stamp 会被误读成「本文件由 Hallmark 生成」，且与 `docs/spec/` 无关。**判定：工具规则冲突，不应按 FAIL 修。**
- **`devtools.css` 的 `#48` 颜色字面量**：该文件的块本身就是主题预览的令牌定义（`--rail`、`--list` … 的两套主题），值来自 `packages/design` 的真实令牌。Hallmark 的「颜色进 token 块」规则在这里恰好是被满足的对象——它们**就是** token 块。**判定：规则误报，但需要维护者确认 devtools 是否算产品代码。**

### 4.2 需要人工判断，脚本给的只是提示

以下每条都没有做浏览器 render，也没有截图；「是否需要改」未定：

1. **`Connect.tsx:113`「1 · 复制提示词 / 2 · 等待连接」**（FAIL 63，middle-dot meta string）。这是两步进度条，不是 byline；脚本按「一行里出现中点」判。是否需要改成竖排或 hairline 分隔，需要设计判断。
2. **`GroupJoin.tsx:46`「回到消息 →」**（FAIL 63，arrow glued to label）。箭头是既有全站写法之一；是否统一去掉箭头，需要与 `ui/kit` 的链接样式一起决定。
3. **`AddFriend.tsx:138` `<video>` 无 poster**（REFLEX 28b）。扫码相机流在用户点击「扫一扫」后才挂载，不在首屏、不是 LCP；Hallmark 的 guard 允许豁免。**判定：可豁免，但未在浏览器验证首屏表现。**
4. **`md h1` 无 `text-wrap: balance`**（WARN F3）。Markdown 标题在气泡里宽度有限，balance 可能加重换行；未实测三档视口。
5. **`NotifySection.tsx:41` `transition-[left]`**（FAIL 10a）。这是 Tailwind 任意值过渡，动的是 `left`（脚本禁止的四个属性之一）；正确做法是 `transition-transform` + `translate`。**判定：这是真实的可访问性/性能问题（触发 layout），但没有在本任务改。**
6. **`ViewSwitcher.tsx:129` 玻璃拟态遮罩**（WARN 29）。`backdrop-blur-sm` + `bg-ink/40`；Hallmark 建议实色或纹理。属审美判断，且是 devtools 浮窗。
7. **首跑中的 `.ambient` 氛围块**（`#000` mask + `blur(60px)`）：并行提交已删除，本文不再评价；如需恢复，需重新评审。

### 4.3 明确没有做的事

- 没有运行 `--render`（需要 dev server 与截图流程），没有在任何视口下打开页面。
- 没有启动网关、没有登录真实社交账号、没有做端到端收发消息。
- 没有修改 `apps/app` 的任何源码，因此**没有任何一项是「已修复」**。
- 没有把 Hallmark 的其它规则（营销页 80 词、hero 首屏、容器居中）套到本应用；它们是页面/营销规则，见 §5。

## 5. 采用的适用方法（只取对 app 有用的部分）

Hallmark 的「Floor」大部分是面向营销页的；对 `apps/app` 这种 app screen（`flow.md` § App screens），本次只采用以下可适用项，并注明来源：

| 采用 | 内容 | 在本仓库的落点 |
|---|---|---|
| 保留品牌与 wiring | 不重设导航、不换组件树；只改样式与状态 | 与 `AGENTS.md` 第 5 条、spec/12 一致 |
| `--scope app`，不套营销 hero / 80 词 | app screen 用密度而不是 hero | 本应用是工作界面，无首屏营销诉求 |
| 八个交互状态 | default / hover / `:focus-visible` / `:active` / disabled / loading / error / success | 现状：`:focus-visible` 有全局兜底（`styles.css:60-63`）、`:active` 有 `.press`（`:156`）、disabled 用 `disabled:opacity-40`；**loading/error/success 不是每个控件都有**，且没有专门的八个状态清单 |
| 44px 粗指针目标 | 触屏最小点击区域 | 现状：`ui/kit/Button.tsx:9` 是 `h-10`/`h-8`（40/32px），`WorkList.tsx:246` 新建任务 `size-7`（28px），`styles.css` 里**没有** `@media (pointer: coarse)` 规则（grep 无命中）；这是真实缺口 |
| focus 可见 | 不得移除 outline | 有全局规则，且 `.field:focus` 用 inset 阴影替代（`:69-73`），可接受 |
| empty 与 error 区分 | 空态与失败态不同屏、不同文案 | 见 `state-matrix.md` §5：多处仍合并（通讯录、App 门控、导入列表、activity） |
| 动效克制 | 只动 transform/opacity；尊重 reduced motion | 现状：`.press` 用 transform（`styles.css:156`），两处 `prefers-reduced-motion`（`styles.css:159,394`）；但 `NotifySection.tsx:41` 动 `left` 违反此条 |

**Hallmark 不是权威产品规范。** 它不覆盖：网关鉴权、路由冻结、scope、协议 schema、空态语义、设备事实。凡涉及这些，以 `docs/spec/`、`proposals/unified-client/contracts.md`（提案，待批准）与本仓库代码为准。

## 6. 文档驱动的优化循环

本仓库采用的循环，顺序不可跳：

1. **Inventory（盘点）**：列出路由→组件→hook→协议方法→状态证据，产出 `README.md` §2 与本文件 §3 的原始结果。
2. **Contract / state matrix**：把每个页面的状态组合写成可核对的表（`state-matrix.md`），明确哪些轴独立、哪些折叠。
3. **纯函数**：可见性、状态映射、布局判定先落成纯函数并单测，例如 `capabilities/features.ts` 的 `featureVisible`、`features/social/lib/session.ts` 的 `socialSessionState`、`shell/layoutMode.ts` 的 `frameOf`。组件只消费，不重新推理。
4. **组件**：按状态表实现渲染分支，每个分支有 `role="status"` 或 `role="alert"`。
5. **真实浏览器多视口**：390×844、820×1180、1280×800，分别在 web / 桌面壳内；键盘、`prefers-reduced-motion`、`pointer: coarse` 各跑一遍。
6. **真实身份与服务**：真实网关登录、真实社交账号、真实设备；不写 mock。缺凭据时记「未测」。
7. **Evidence**：截图、命令输出、原始计数；失败不覆盖。
8. **只把批准的设计回写规范**：改 `docs/spec/`、`docs/architecture.md`、`docs/decisions.md`、`docs/index.md`、`AGENTS.md` 属于设计变更，需维护者批准；本目录三份文件是事实文档，不承担该职责。

## 7. 可执行检查清单（每项都要给出结论与证据）

未执行或未通过的项必须写「未测」或「失败」，不得留空：

- [ ] `npm run typecheck -w @yonder/app` 通过（记录退出码与 commit）
- [ ] `npx vitest run apps/app/test` 通过（记录文件/用例计数）
- [ ] `npx biome check apps/app/src` 无新增错误
- [ ] `node ~/.claude/skills/hallmark/scripts/sloplint.mjs apps/app/src --scope app --genre modern-minimal`：逐条处置 FAIL（修/豁免并写明理由）
- [ ] 三档视口 × 三种壳（web / `__YONDER_SHELL__="desktop"` / `"mobile"`）截图，验证导航、第二列、右栏
- [ ] `state-matrix.md` 每一页的 `pending / empty / error / forbidden / unsupported / unbound / offline` 分支实际触达
- [ ] 键盘：Tab 顺序、Esc 关菜单、方向键在菜单内循环、焦点归还
- [ ] `prefers-reduced-motion: reduce` 下无动画
- [ ] `pointer: coarse`（或在真机）下所有可点目标 ≥44px
- [ ] 真实网关登录 + 真实社交账号 + 真实设备，跑通「公开页 → 社交登录 → 加好友 → 发消息」
- [ ] 断网 / 网关重启 / 社交后端 404 三种失败各截一次图
- [ ] `#/console` 添加远程节点（当前预期失败，见 `README.md` §4.5）

## 8. 本次记录的验证结果（写文档时）

以下只为固定基线，不代表产品验收。同一工作区在写文档期间被并行改动，因此记录**两次不同时刻**的结果，不用后一次覆盖前一次：

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npm run typecheck -w @yonder/app` | 01:42、01:48、01:58 三次均退出码 0（`adaefd1ba96b` / `10fef489cbf1` / `35b81d171f13`） |
| 前端测试（01:48） | `npx vitest run apps/app/test` | **43 文件 / 366 用例：358 通过，8 失败**。失败在 `test/social/SocialChat.test.tsx`（2，`ReferenceError: location is not defined`）与 `test/social/SocialLogin.test.tsx`（6，测试仍按邮箱密码表单断言，而组件已改为验证码/手机号文案）。属并行开发中的测试与实现不同步 |
| 前端测试（01:54、01:58） | 同上 | **46 文件 / 408 通过，0 失败**（两次一致）。期间有并行提交补上了 `VerifySheet`/`AccountSecurity` 的测试并改了两处旧断言；**不是本任务修复**，本任务没有改 `apps/app` 源码 |
| Biome（01:42） | `npx biome check apps/app/src` | 3 个错误（`capabilities/features.ts` 格式类），并行提交产生 |
| Biome（01:54、01:58） | 同上 | 124 文件，无错误 |
| Hallmark lint | 见 §2/§3 | 首跑 5 FAIL/1 REFLEX/2 WARN（65 文件）；01:58 复跑 49 FAIL/1 REFLEX/2 WARN（72 文件），差异原因已列 |
| 浏览器 render | — | **未测** |
| 真实网关 / 社交 / 设备 | — | **未测** |
