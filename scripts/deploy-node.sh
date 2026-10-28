#!/usr/bin/env bash
# Deploy a Yonder node to a Linux x86_64 server (user-level systemd, no build on the server).
#
# Usage: scripts/deploy-node.sh <command> [host] [ref]
#   build    <ref>          build in a local linux/amd64 Docker container -> $OUT/yonder-<version>.tar.gz
#   push     <host> <ref>   upload the artifact (and deploy/node config) to <host>:/var/tmp/yonder-deploy
#   install  <host> <ref>   create user, unpack runtime, write config + service, restart
#   status   <host>         service state, memory, versions
#   rollback <host>         switch `current` back to the previous runtime, restart and health-check
#   nginx    <host> maint|proxy [port]  add /console/ to the YONDER_PUBLIC_ORIGIN server block
#   uninstall <host> [--purge [--yes]] stop and remove the service (data kept);
#                            --purge also deletes user yonder and its data (typed confirmation unless --yes)
#
# <host> is required for every command except `build`; pass it as an argument or via
# YONDER_DEPLOY_HOST. Private per-server values (hosts, key file paths) live in
# deploy/node/local.env (gitignored); see deploy/node/local.env.example.
# nginx commands additionally require YONDER_PUBLIC_ORIGIN (e.g. https://console.example.com).
#
# Server layout (user yonder): ~/.local/share/yonder/runtime/<version>, runtime/current -> <version>,
# runtime/.previous (name of the prior version), runtime/bin/yonder, home in ~/.local/share/yonder/home.
# Node 24 ships inside each runtime (<version>/.node), so the system Node is untouched.
#
# Rollback steps per server change (what `install` touches):
#   - runtime/<version> is new; `rollback` flips `current` back, old versions are kept (last 3).
#   - user yonder / linger / unit dev.yonder.service: `uninstall <host> --purge` removes them.
#   - home/ is created once and never overwritten except yonder.yaml, agents/main/agent.yaml,
#     and .yonder/auth.json (only when absent); previous copies are saved as *.pre-deploy-<stamp>.
set -euo pipefail

CMD=${1:-}
REF=${3:-HEAD}
OUT=${YONDER_DEPLOY_OUT:-$HOME/.cache/yonder-deploy}
REPO=$(cd "$(dirname "$0")/.." && pwd)
IMAGE=${YONDER_BUILD_IMAGE:-node:24-bookworm-slim}
REMOTE_TMP=/var/tmp/yonder-deploy
SSH=(ssh -o BatchMode=yes)

die() { echo "deploy-node: $*" >&2; exit 1; }
usage() { sed -n '2,17p' "$0"; exit 2; }

# Private, gitignored overrides: YONDER_DEPLOY_HOST, YONDER_SILICONFLOW_KEY_FILE, ...
if [ -f "$REPO/deploy/node/local.env" ]; then
	# shellcheck source=deploy/node/local.env.example disable=SC1091
	. "$REPO/deploy/node/local.env"
fi

HOST=${2:-${YONDER_DEPLOY_HOST:-}}
need_host() { [ -n "$HOST" ] || { echo "deploy-node: missing <host> (argument or YONDER_DEPLOY_HOST)" >&2; usage; }; }

version_of() { # <ref> -> <cli version>-<sha7>
	local v sha
	sha=$(git -C "$REPO" rev-parse --short=7 "$1^{commit}") || die "unknown ref $1"
	v=$(git -C "$REPO" show "$1:packages/cli/package.json" | sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' | head -n 1)
	[ -n "$v" ] || die "cannot read cli version at $1"
	echo "$v-$sha"
}

check_version() { # guard: <version>-<sha7> is used in paths and remote commands
	case "$1" in
		*[!0-9A-Za-z.+-]*) die "unsafe version string: $1" ;;
	esac
	case "$1" in
		*-*) : ;;
		*) die "version must be <version>-<sha7>, got: $1" ;;
	esac
	local rest=${1##*-}
	[ ${#rest} -eq 7 ] || die "version suffix must be a 7-char sha, got: $1"
	[[ $rest =~ ^[0-9a-f]{7}$ ]] || die "version suffix must be a 7-hex sha, got: $1"
}

cmd_build() {
	local ver; ver=$(version_of "$REF")
	check_version "$ver"
	mkdir -p "$OUT"
	echo "building $ver ($REF) in $IMAGE linux/amd64" >&2
	docker volume create yonder-npm-cache >/dev/null
	git -C "$REPO" archive "$REF" | docker run --rm -i --platform linux/amd64 \
		-v yonder-npm-cache:/root/.npm "$IMAGE" sh -c '
set -e
mkdir /build && cd /build && tar -x
npm ci --no-audit --no-fund >&2
npm run build >&2
npm prune --omit=dev >&2
mkdir -p .node/bin .node/lib/node_modules
cp /usr/local/bin/node .node/bin/node
cp -r /usr/local/lib/node_modules/npm .node/lib/node_modules/npm
ln -s ../lib/node_modules/npm/bin/npm-cli.js .node/bin/npm
ln -s ../lib/node_modules/npm/bin/npx-cli.js .node/bin/npx
tar -czf - .' >"$OUT/yonder-$ver.tar.gz.part"
	mv "$OUT/yonder-$ver.tar.gz.part" "$OUT/yonder-$ver.tar.gz"
	ls -l "$OUT/yonder-$ver.tar.gz" >&2
	echo "$OUT/yonder-$ver.tar.gz"
}

cmd_push() {
	need_host
	local ver; ver=$(version_of "$REF")
	check_version "$ver"
	[ -f "$OUT/yonder-$ver.tar.gz" ] || die "missing $OUT/yonder-$ver.tar.gz (run build first)"
	"${SSH[@]}" "$HOST" "mkdir -p $REMOTE_TMP && chmod 755 $REMOTE_TMP"
	"${SSH[@]}" "$HOST" "cat > $REMOTE_TMP/yonder-$ver.tar.gz.part && mv $REMOTE_TMP/yonder-$ver.tar.gz.part $REMOTE_TMP/yonder-$ver.tar.gz && chmod 644 $REMOTE_TMP/yonder-$ver.tar.gz" <"$OUT/yonder-$ver.tar.gz"
	local stage; stage=$(mktemp -d)
	cp -R "$REPO/deploy/node/." "$stage/"
	if [ -n "${YONDER_PUBLIC_ORIGIN:-}" ]; then
		case "$YONDER_PUBLIC_ORIGIN" in *[!0-9A-Za-z.:/-]*) die "unsafe YONDER_PUBLIC_ORIGIN" ;; esac
		sed -i.bak "s#__YONDER_PUBLIC_ORIGIN__#${YONDER_PUBLIC_ORIGIN%/}#" "$stage/yonder.yaml"
	else
		sed -i.bak '/__YONDER_PUBLIC_ORIGIN__/d' "$stage/yonder.yaml"
	fi
	rm -f "$stage/yonder.yaml.bak"
	COPYFILE_DISABLE=1 tar -C "$stage" --exclude=local.env --exclude=local.env.example -czf - . | "${SSH[@]}" "$HOST" "cat > $REMOTE_TMP/config.tgz && chmod 644 $REMOTE_TMP/config.tgz"
	rm -rf "$stage"
	echo "pushed $ver to $HOST:$REMOTE_TMP"
}

# The key is read locally (path configurable via YONDER_SILICONFLOW_KEY_FILE in local.env) and sent
# over ssh stdin only; it is never printed, logged, or stored in the repo.
local_siliconflow_key() {
	python3 - "${YONDER_SILICONFLOW_KEY_FILE:-}" <<'PY'
import json, os, sys
paths = [p for p in sys.argv[1:] if p]
paths += ["~/.local/share/yonder-harness/home/.yonder/auth.json", "~/.pi/agent/auth.json"]
for p in paths:
    try:
        k = json.load(open(os.path.expanduser(p)))["siliconflow"]["key"]
    except Exception:
        continue
    if k and not k.startswith("!"):
        sys.stdout.write(k)
        sys.exit(0)
sys.exit(1)
PY
}

cmd_install() {
	need_host
	local ver; ver=$(version_of "$REF")
	check_version "$ver"
	local key_flag
	if "${SSH[@]}" "$HOST" 'test -s /home/yonder/.local/share/yonder/home/.yonder/auth.json' 2>/dev/null; then key_flag=0; else key_flag=1; fi
	if [ "$key_flag" = 1 ]; then
		# Keep key data exclusively on the pipeline stdin
		remote_install_script | "${SSH[@]}" "$HOST" "VER=$ver bash -s"
		# shellcheck disable=SC2016
		local_siliconflow_key | "${SSH[@]}" "$HOST" 'umask 077; d=/home/yonder/.local/share/yonder/home/.yonder; install -d -o yonder -g yonder -m 700 "$d"; python3 - "$d/auth.json" <<"PY"
import json,sys
json.dump({"siliconflow":{"type":"api_key","key":sys.stdin.read()}}, open(sys.argv[1], "w"))
PY
chown yonder:yonder "$d/auth.json"; chmod 600 "$d/auth.json"'
		"${SSH[@]}" "$HOST" "runuser -u yonder -- env XDG_RUNTIME_DIR=/run/user/\$(id -u yonder) DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/\$(id -u yonder)/bus systemctl --user restart dev.yonder.service"
	else
		remote_install_script | "${SSH[@]}" "$HOST" "VER=$ver bash -s"
	fi
	echo "installed $ver on $HOST"
}

remote_install_script() {
	cat <<'EOS'
set -euo pipefail
A=/var/tmp/yonder-deploy/yonder-$VER.tar.gz
[ -f "$A" ] || { echo "artifact missing: $A" >&2; exit 1; }
id yonder >/dev/null 2>&1 || useradd -m -s /bin/bash yonder
loginctl enable-linger yonder
UIDY=$(id -u yonder)
systemctl start "user@$UIDY.service"
for i in 1 2 3 4 5 6 7 8 9 10; do [ -S /run/user/$UIDY/bus ] && break; sleep 1; done
Y() { runuser -u yonder -- env HOME=/home/yonder XDG_RUNTIME_DIR=/run/user/$UIDY DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$UIDY/bus "$@"; }
R=/home/yonder/.local/share/yonder/runtime
HOMEDIR=/home/yonder/.local/share/yonder/home
STAMP=$(date +%Y%m%d%H%M%S)
Y mkdir -p "$R/bin" /home/yonder/.local/bin /home/yonder/.config/systemd/user
if [ ! -d "$R/$VER" ]; then
	Y mkdir "$R/$VER.tmp"
	Y tar -xzf "$A" -C "$R/$VER.tmp"
	Y mv "$R/$VER.tmp" "$R/$VER"
fi
cat > "$R/bin/yonder" <<EOW
#!/bin/sh
YONDER_INSTALL=$R
YONDER_HOME=\${YONDER_HOME:-$HOMEDIR}
PATH=$R/current/.node/bin:\$PATH
export YONDER_INSTALL YONDER_HOME PATH
exec node $R/current/packages/cli/dist/index.js "\$@"
EOW
chown yonder:yonder "$R/bin/yonder"; chmod 755 "$R/bin/yonder"
Y ln -sfn "$R/bin/yonder" /home/yonder/.local/bin/yonder
prev=$(Y readlink "$R/current" 2>/dev/null || true); prev=${prev##*/}
if [ "$prev" != "$VER" ]; then
	[ -n "$prev" ] && Y sh -c "echo $prev > $R/.previous"
	Y ln -sfn "$R/$VER" "$R/.current.new"
	Y mv -T "$R/.current.new" "$R/current"
fi
# home: init once, then overlay the cloud config
if [ ! -f "$HOMEDIR/yonder.yaml" ]; then Y "$R/bin/yonder" init "$HOMEDIR" >/dev/null; fi
Y mkdir -p /home/yonder/.config/yonder
CFG=$(mktemp -d); tar -xzf /var/tmp/yonder-deploy/config.tgz -C "$CFG"; chmod -R a+rX "$CFG"
for pair in yonder.yaml:yonder.yaml agent.yaml:agents/main/agent.yaml; do
	src=${pair%%:*}; dst=$HOMEDIR/${pair#*:}
	if ! cmp -s "$CFG/$src" "$dst"; then
		[ -f "$dst" ] && Y cp -p "$dst" "$dst.pre-deploy-$STAMP"
		Y cp "$CFG/$src" "$dst"
		# the remote access token hash lives in yonder.yaml; carry it over the overlay
		if [ "$src" = yonder.yaml ] && [ -f "$dst.pre-deploy-$STAMP" ]; then
			hash=$(sed -n 's/^[[:space:]]*accessTokenHash:[[:space:]]*"\{0,1\}\(sha256:[0-9a-f]\{64\}\)"\{0,1\}[[:space:]]*$/\1/p' "$dst.pre-deploy-$STAMP" | head -n 1)
			[ -z "$hash" ] || Y sed -i "/^gateway:/a\\  accessTokenHash: $hash" "$dst"
		fi
	fi
done
Y mkdir -p "$HOMEDIR/.yonder"; Y chmod 700 "$HOMEDIR/.yonder"
# 旧节点（0.2）还装着 dev.yonder.harness.service：先停用并删掉旧单元，避免同名任务双开
if [ -f /home/yonder/.config/systemd/user/dev.yonder.harness.service ]; then
	Y systemctl --user disable --now dev.yonder.harness.service >/dev/null 2>&1 || true
	rm -f /home/yonder/.config/systemd/user/dev.yonder.harness.service
fi
cat > /home/yonder/.config/systemd/user/dev.yonder.service <<EOU
# YonderService={"home":"$HOMEDIR","install":"$R"}
[Unit]
Description=Yonder Harness (cloud node)
After=network-online.target
[Service]
Type=simple
ExecStart=$R/bin/yonder start --home $HOMEDIR --json
Environment=YONDER_INSTALL=$R
Environment=YONDER_HOME=$HOMEDIR
Environment=PATH=$R/current/.node/bin:/usr/local/bin:/usr/bin:/bin
Environment=NODE_OPTIONS=--max-old-space-size=512
EnvironmentFile=-/home/yonder/.config/yonder/env
MemoryMax=700M
MemorySwapMax=0
Restart=on-failure
RestartSec=2
[Install]
WantedBy=default.target
EOU
chown yonder:yonder /home/yonder/.config/systemd/user/dev.yonder.service
Y systemctl --user daemon-reload
Y systemctl --user enable dev.yonder.service >/dev/null 2>&1
Y systemctl --user restart dev.yonder.service
# keep the newest 3 runtimes plus current/previous
cur=$(Y readlink "$R/current"); cur=${cur##*/}; pv=$(cat "$R/.previous" 2>/dev/null || true)
ls -1t "$R" | grep -v -e '^bin$' -e '^current$' | tail -n +4 | while read -r d; do
	[ "$d" = "$cur" ] || [ "$d" = "$pv" ] || rm -rf "$R/$d"
done
rm -rf "$CFG"
echo "runtime: $cur (previous: ${pv:-none})"
EOS
}

cmd_status() {
	need_host
	"${SSH[@]}" "$HOST" 'bash -s' <<'EOS'
UIDY=$(id -u yonder) || exit 1
Y() { runuser -u yonder -- env HOME=/home/yonder XDG_RUNTIME_DIR=/run/user/$UIDY DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$UIDY/bus "$@"; }
R=/home/yonder/.local/share/yonder/runtime
echo "current:  $(readlink $R/current)"; echo "previous: $(cat $R/.previous 2>/dev/null)"
Y systemctl --user show dev.yonder.service -p ActiveState,SubState,MainPID,MemoryCurrent,MemoryMax,MemorySwapMax,NRestarts
Y /home/yonder/.local/bin/yonder version 2>&1 | head -n 3
EOS
}

cmd_rollback() {
	need_host
	"${SSH[@]}" "$HOST" 'bash -s' <<'EOS'
set -euo pipefail
UIDY=$(id -u yonder)
Y() { runuser -u yonder -- env HOME=/home/yonder XDG_RUNTIME_DIR=/run/user/$UIDY DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$UIDY/bus "$@"; }
R=/home/yonder/.local/share/yonder/runtime
prev=$(cat "$R/.previous" 2>/dev/null) || { echo "no previous runtime" >&2; exit 1; }
[ -d "$R/$prev" ] || { echo "previous runtime $prev is gone" >&2; exit 1; }
cur=$(readlink "$R/current"); cur=${cur##*/}
restore() { # switch back to $1 and restart
	Y ln -sfn "$R/$1" "$R/.current.new"; Y mv -T "$R/.current.new" "$R/current"
	Y systemctl --user restart dev.yonder.service
}
healthy() { # service active + gateway answers on loopback
	Y systemctl --user is-active --quiet dev.yonder.service || return 1
	Y sh -c 'for i in 1 2 3 4 5 6 7 8 9 10; do
		curl -fsS --max-time 2 "http://127.0.0.1:${YONDER_HEALTH_PORT:-7690}/login" >/dev/null 2>&1 && exit 0
		sleep 1
	done; exit 1'
}
restore "$prev"
Y sh -c "echo $cur > $R/.previous"
if ! healthy; then
	echo "rollback to $prev failed health check; restoring $cur" >&2
	Y sh -c "echo $prev > $R/.previous"
	restore "$cur"
	healthy || { echo "health check failed after restore; investigate manually" >&2; exit 1; }
	exit 1
fi
echo "rolled back: $cur -> $prev"
EOS
}

# Adds only a marked `location /console/` block to /etc/nginx/conf.d/yonder.conf, inside the
# server block whose server_name matches the host of YONDER_PUBLIC_ORIGIN; nothing else is edited.
# Undo: restore the printed backup file and `nginx -s reload`, or rerun with `maint`.
cmd_nginx() {
	need_host
	[ -n "${YONDER_PUBLIC_ORIGIN:-}" ] || die "YONDER_PUBLIC_ORIGIN is required for nginx commands (e.g. https://console.example.com)"
	local origin_host
	origin_host=$(python3 -c 'import sys,urllib.parse as u; h=u.urlparse(sys.argv[1]).hostname or ""; print(h) if h else sys.exit(1)' "$YONDER_PUBLIC_ORIGIN") \
		|| die "cannot parse host from YONDER_PUBLIC_ORIGIN: ${YONDER_PUBLIC_ORIGIN}"
	local mode=${3:-}; local port=${4:-}
	case "$mode" in maint|proxy) ;; *) die "nginx <host> maint|proxy [port]" ;; esac
	if [ "$mode" = proxy ]; then case "$port" in ''|*[!0-9]*) die "proxy needs a numeric port" ;; esac; fi
	"${SSH[@]}" "$HOST" "mkdir -p /usr/share/nginx/yonder-console && cat > /usr/share/nginx/yonder-console/index.html && chmod -R a+rX /usr/share/nginx/yonder-console" <"$REPO/deploy/node/maintenance.html"
	"${SSH[@]}" "$HOST" "mkdir -p /var/tmp/yonder-deploy && cat > /var/tmp/yonder-deploy/nginx-console.py" <"$REPO/deploy/node/nginx-console.py"
	"${SSH[@]}" "$HOST" "MODE=$mode PORT=$port ORIGIN_HOST=$origin_host bash -s" <<'EOS'
set -euo pipefail
F=/etc/nginx/conf.d/yonder.conf
B=$F.bak-$(date +%Y%m%dT%H%M%SZ)
cp -p "$F" "$B"; echo "backup: $B"
restore() { cp -p "$B" "$F"; echo "restored $B" >&2; }
# Explicit checks below restore on failures without an ERR-trap double restore.
python3 /var/tmp/yonder-deploy/nginx-console.py "$F"
if ! nginx -t 2>&1; then
	restore; exit 1
fi
if ! nginx -s reload 2>&1; then
	restore; nginx -t >/dev/null 2>&1 || true; nginx -s reload || true
	exit 1
fi
echo reloaded
EOS
}

cmd_uninstall() {
	need_host
	local purge=0 confirm_arg=0
	shift || true # drop command name
	local arg
	for arg in "$@"; do
		case "$arg" in
			--purge) purge=1 ;;
			--yes) confirm_arg=1 ;;
			*) die "uninstall <host> [--purge [--yes]]" ;;
		esac
	done
	local confirm="n"
	if [ "$purge" = 1 ] && [ "$confirm_arg" != 1 ]; then
		printf 'uninstall --purge deletes user yonder and ALL its data. Type "purge" to continue: ' >&2
		read -r confirm
		[ "$confirm" = "purge" ] || die "aborted (data kept; run without --purge for a plain uninstall)"
	fi
	"${SSH[@]}" "$HOST" "PURGE=$purge bash -s" <<'EOS'
set -u
id yonder >/dev/null 2>&1 || { echo "no user yonder"; exit 0; }
UIDY=$(id -u yonder)
Y() { runuser -u yonder -- env HOME=/home/yonder XDG_RUNTIME_DIR=/run/user/$UIDY DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$UIDY/bus "$@"; }
Y systemctl --user disable --now dev.yonder.service
rm -f /home/yonder/.config/systemd/user/dev.yonder.service
if [ "$PURGE" = "1" ]; then
	loginctl disable-linger yonder; pkill -u yonder || true; userdel -r yonder; rm -rf /var/tmp/yonder-deploy
	echo "purged user yonder and its data"
fi
echo "uninstalled (data kept)"
EOS
}

case "$CMD" in
	build) REF=${2:-HEAD}; cmd_build ;;
	push) cmd_push ;;
	install) cmd_install ;;
	status) cmd_status ;;
	rollback) cmd_rollback ;;
	nginx) cmd_nginx "$@" ;;
	uninstall) cmd_uninstall "$@" ;;
	*) usage ;;
esac
