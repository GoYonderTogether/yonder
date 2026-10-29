#!/bin/sh
# 前端 dev 演示（vite dev + HMR），固定 5180；主人刷新即可看到改动。
# 用法：dev-demo.sh [start|stop|status]（默认 start）
#   网关接口（/api/rpc、/api/stream、/api/logout、POST /login）→ YONDER_GATEWAY（默认演示网关 http://127.0.0.1:18795）
#   社交接口（其余 /api、/ws）→ YONDER_SOCIAL（默认云端 https://yonder.zethai.cn；本机测试后端：http://127.0.0.1:18030）
# 只管理自己的 pid 文件与 5180 端口，不 kill 别人的进程。日志与 pid 在 $YONDER_DEV_DIR（默认 ~/.local/state/yonder-app-dev）。
set -eu
APP="$(cd "$(dirname "$0")/.." && pwd)"
DIR="${YONDER_DEV_DIR:-$HOME/.local/state/yonder-app-dev}"
PIDFILE="$DIR/vite.pid"
LOG="$DIR/vite.log"
PORT=5180
URL="http://127.0.0.1:$PORT/"
mkdir -p "$DIR"

running() { [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; }

case "${1:-start}" in
start)
	if running; then echo "已在运行：pid $(cat "$PIDFILE")，${URL}"; exit 0; fi
	if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
		echo "端口 $PORT 被其他进程占用，拒绝启动（不会去 kill）：" >&2
		lsof -nP -iTCP:$PORT -sTCP:LISTEN >&2
		exit 1
	fi
	cd "$APP"
	# 真实接口（不是名片站的本地原型数据）；VITE_API=mock 可切回原型。
	VITE_API="${VITE_API:-http}" nohup npx vite --host 127.0.0.1 --port $PORT --strictPort >"$LOG" 2>&1 &
	echo $! >"$PIDFILE"
	i=0
	while [ $i -lt 60 ]; do
		if curl -fs -o /dev/null "${URL}"; then echo "已启动：${URL}（日志 ${LOG}）"; exit 0; fi
		i=$((i + 1)); sleep 1
	done
	echo "60 秒内没有就绪，见 $LOG" >&2; exit 1 ;;
stop)
	if running; then kill "$(cat "$PIDFILE")" && rm -f "$PIDFILE" && echo "已停止"; else echo "没有在运行"; fi ;;
status)
	if running; then echo "运行中：pid $(cat "$PIDFILE")，${URL}"; else echo "未运行"; fi ;;
*) echo "用法：dev-demo.sh [start|stop|status]" >&2; exit 2 ;;
esac
