# PT-P159 验证状态（2026-10-28）

未交付 `code-intel_symbol_search`。P001 的可选插件已存在；并行中的 `lens-mcp.ts` 每次响应后结束 MCP 子进程，实测不能完成冷索引构建。`ExecutionEnv.exec` 仅支持一次性命令及输出回调，没有持久双向 stdin；现有 `mcp-client` 的连接是插件内部实现，stdio 限 `node:local`，不能跨插件导入。需要共享的、属于选定执行环境的 MCP 长连接和生命周期/取消契约，再接此工具；不能另建脱离 T04 的后台进程或第二套索引。

真实后端为本机 pi-lens 4.4.6。原包直接启动报缺 `@earendil-works/pi-tui`；在临时目录复制包并链接现有依赖后，MCP `tools/list` 握手成功，确认 `pilens_symbol_search` 参数为必需 `query`、可选 `cwd`、`limit`、`paths`、`lang`。在临时 HOME 和单文件项目（仓库真实 `packages/sdk/src/index.ts` 副本）保持同一个 MCP 连接，冷搜索 11ms 返回 `available:false/building`，两秒后 4ms 命中 `index.ts`，`module_report` 找到 `parseRef`，`read_symbol` 返回真实 13–25 行；无匹配返回 `available:true` 和空数组。预先取消请求得到 `AbortError`，执行中取消未测。

修改临时文件追加 `uniquelyFreshSymbol` 后立即搜索无命中；调用 `pilens_session_start` 后每 2 秒重试，共 6 次仍未命中。刷新验收未通过，须查明实际更新触发方式，不能宣称自动刷新。正常 MCP 客户端关闭的另一组冷调用在第 3 次变热；和下方直接验证的 `child.kill()` 行为不同。

可复现当前桥的冷索引检查（所有输出不含凭据；不修改主人 home 或服务）：

```sh
TASK_TMP=$(mktemp -d)
mkdir -p "$TASK_TMP/node_modules/@earendil-works" "$TASK_TMP/home" "$TASK_TMP/project" "$TASK_TMP/bin"
cp -R "$HOME/.pi/agent/npm/node_modules/pi-lens" "$TASK_TMP/node_modules/pi-lens"
for p in "$HOME"/.pi/agent/npm/node_modules/*; do
  [ "${p##*/}" = pi-lens ] || [ "${p##*/}" = @earendil-works ] || ln -s "$p" "$TASK_TMP/node_modules/${p##*/}"
done
for p in "$PWD"/node_modules/*; do
  [ -e "$TASK_TMP/node_modules/${p##*/}" ] || ln -s "$p" "$TASK_TMP/node_modules/${p##*/}"
done
for p in "$PWD"/node_modules/@earendil-works/*; do ln -s "$p" "$TASK_TMP/node_modules/@earendil-works/${p##*/}"; done
ln -s "$TASK_TMP/node_modules/pi-lens/dist/mcp/server.js" "$TASK_TMP/bin/pi-lens-mcp"
cp packages/sdk/src/index.ts "$TASK_TMP/project/index.ts"
HOME="$TASK_TMP/home" TASK_TMP="$TASK_TMP" PATH="$TASK_TMP/bin:$PATH" node --input-type=module <<'JS'
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const source = await readFile('plugins/code-intel/src/lens-mcp.ts', 'utf8');
const script = source.match(/const client = `([\s\S]*?)`;/)[1].replaceAll('\\\\n', '\\n');
const cwd = process.env.TASK_TMP + '/project';
for (let i = 0; i < 3; i++) {
  const r = spawnSync(process.execPath, ['-e', script, 'pilens_symbol_search', JSON.stringify({query:'parseRef', cwd})], {cwd, encoding:'utf8', timeout:20000});
  console.log(i, r.status, r.stdout, r.stderr);
  await new Promise(resolve => setTimeout(resolve, 2000));
}
JS
```

结果：3 次均退出 0 且 `available:false/building`；本次尚未验证模型调用、Yonder 工具注册/未选择隔离、输出截断与 T05、运行中取消或新改动刷新。后续接线必须复用单一 MCP 通路、保留上游 BM25 和执行环境边界，并完成这些验收、spec20 文档及契约检查。
