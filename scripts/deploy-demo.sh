#!/usr/bin/env bash
# deploy-demo.sh — 构建 apps/app 并部署到 zeth-root:/opt/yonder-demo/web/
#
# 用法:
#   scripts/deploy-demo.sh            # 构建 + tar over ssh 上传 + 原子切换 current + 清理旧目录
#   scripts/deploy-demo.sh --no-build # 跳过构建，直接上传现有 apps/app/dist
#
# 行为:
# - 工作区有未提交改动只打印警告，不阻断。
# - 在 apps/app 执行 build:web（HTTP API 模式，web 部署用）。
# - 目标目录名: demo-<8位sha>-<时间戳>，上传到 /opt/yonder-demo/web/<目录>。
# - ln -sfn + mv -T 原子切换 current 软链接；nginx root 指向 current。
# - 保留最近 5 个 demo-* 目录，其余删除（不删 0.3.26110303-*，不删 current 指向的目录）。
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$REPO_DIR/apps/app"
SSH_OPTS=(-o 'ProxyCommand=nc -b en0 -G 15 %h %p')
REMOTE_HOST=zeth-root
REMOTE_WEB=/opt/yonder-demo/web
KEEP=5

if [[ ! -f "$APP_DIR/package.json" ]]; then
  echo "错误: 未找到 $APP_DIR" >&2
  exit 1
fi

cd "$REPO_DIR"
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "警告: 工作区有未提交改动（继续部署）" >&2
  git status --short >&2
fi

if [[ "${1:-}" != "--no-build" ]]; then
  echo "==> 构建 apps/app"
  (cd "$APP_DIR" && npm run build:web)
else
  echo "==> 跳过构建，使用现有 $APP_DIR/dist"
fi

SHA="$(git rev-parse --short=8 HEAD)"
STAMP="$(date +%Y%m%d-%H%M%S)"
DIR_NAME="demo-${SHA}-${STAMP}"
REMOTE_DIR="$REMOTE_WEB/$DIR_NAME"
LOCAL_DIR="$APP_DIR/dist"

# 注意: 服务器上没有 rsync，改用 tar over ssh 上传（先清空目标目录，等价 --delete）。
echo "==> 上传到 $REMOTE_HOST:$REMOTE_DIR (tar over ssh)"
ssh "${SSH_OPTS[@]}" "$REMOTE_HOST" "mkdir -p '$REMOTE_DIR' && cd '$REMOTE_DIR' && find . -mindepth 1 -maxdepth 1 -exec rm -rf {} +"
tar -C "$LOCAL_DIR" -cf - . | ssh "${SSH_OPTS[@]}" "$REMOTE_HOST" "tar -C '$REMOTE_DIR' -xf -"

echo "==> 原子切换 current -> $DIR_NAME"
ssh "${SSH_OPTS[@]}" "$REMOTE_HOST" "cd $REMOTE_WEB && ln -sfn '$DIR_NAME' current.new && mv -T current.new current"

echo "==> 清理旧 demo-* 目录（保留最近 $KEEP 个）"
ssh "${SSH_OPTS[@]}" "$REMOTE_HOST" bash -s "$REMOTE_WEB" "$KEEP" <<'CLEANUP'
set -euo pipefail
web="$1"; keep="$2"
current_target="$(basename "$(readlink "$web/current")")"
count=0
while IFS= read -r d; do
  count=$((count+1))
  if (( count <= keep )); then continue; fi
  case "$d" in
    demo-*) ;;                              # 仅删 demo-* 前缀
    *) continue ;;
  esac
  [ "$d" = "$current_target" ] && continue  # 不删 current 指向的目录
  path="$web/$d"
  case "$path" in
    /opt/yonder-demo/web/demo-*) rm -rf "$path"; echo "已删除 $path" ;;
    *) echo "跳过异常路径: $path" ;;
  esac
done < <(cd "$web" && ls -1dt demo-* 2>/dev/null || true)
CLEANUP

echo "==> 完成: $REMOTE_DIR (current -> $DIR_NAME)"
