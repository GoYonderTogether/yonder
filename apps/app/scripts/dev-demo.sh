#!/bin/sh
# 前端 dev 演示（vite dev + HMR），固定 5180；主人刷新即可看到改动。
# 用法：dev-demo.sh [start|stop|status]（默认 start）
#   网关接口（/api/rpc、/api/stream、/api/logout、POST /login）→ YONDER_GATEWAY（默认演示网关 http://127.0.0.1:18795）
#   社交接口（其余 /api、/ws）→ YONDER_SOCIAL（默认云端 https://yonderbot.net；本机测试后端：http://127.0.0.1:18030）
# 免手动登录（只在本机 vite serve 生效，见 apps/app/vite.config.ts）：
#   默认原型数据（名片站展示数据，预置成已登录的演示用户）；DEMO_SOCIAL=cloud 才走真实社交接口，主人自己登录。
#   网关登录票据由演示实例自己的 YONDER_DEV_HOME + YONDER_DEV_CLI 签发，令牌不打印、不落日志。
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
	# 网关自动登录用演示实例自己的 home 与 CLI（~/Documents/yonder-demo-fe）；不在就跳过自动登录。
	export YONDER_DEV_HOME="${YONDER_DEV_HOME:-$HOME/Documents/yonder-demo-fe/home}"
	export YONDER_DEV_CLI="${YONDER_DEV_CLI:-$HOME/Documents/yonder-demo-fe/snapshot/packages/cli/dist/index.js}"
	export YONDER_DEV_AUTOLOGIN=1
	# 默认原型数据（不需要社交登录）；DEMO_SOCIAL=cloud 改走真实云端接口。
	if [ "${DEMO_SOCIAL:-}" = "cloud" ]; then
		VITE_API=http nohup npx vite --host 127.0.0.1 --port $PORT --strictPort >"$LOG" 2>&1 &
	else
		env -u VITE_API nohup npx vite --host 127.0.0.1 --port $PORT --strictPort >"$LOG" 2>&1 &
	fi
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
