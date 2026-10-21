## Summary · 说明

<!-- What changes and why. 改了什么，为什么。 -->

## Checklist · 检查

- [ ] `npm run build && npm run typecheck && npm test && npm run lint` pass · 以上命令均通过
- [ ] If the design changed, `docs/spec/` and `docs/decisions.md` were updated first · 若改动设计，已先改 `docs/spec/` 并在 `docs/decisions.md` 记录
- [ ] pi packages are imported only under `packages/core/src/runtime/`; plugins depend only on `@yonder/sdk` · pi 只在 `packages/core/src/runtime/` 引入，插件只依赖 `@yonder/sdk`
- [ ] No mock models or fake data; model-dependent tests use a real model or are reported as not tested · 没有模拟模型或假数据；依赖模型的测试用真实模型，否则标注“未测”
- [ ] User-visible changes are noted under `## [Unreleased]` in `CHANGELOG.md` · 对外可见的变化已记入 `CHANGELOG.md` 的 `## [Unreleased]`
