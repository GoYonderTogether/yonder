#!/usr/bin/env bash
# Deploy a Yonder node to a Linux x86_64 server (user-level systemd, no build on the server).
#
# Usage: scripts/deploy-node.sh <command> [host] [ref]
#   build    <ref>          build in a local linux/amd64 Docker container -> $OUT/yonder-<version>.tar.gz
#   push     <host> <ref>   upload the artifact (and deploy/node config) to <host>:/var/tmp/yonder-deploy
#   install  <host> <ref>   create user, unpack runtime, write config + service, restart
#   status   <host>         service state, memory, versions
#   rollback <host>         switch `current` back to the previous runtime and restart
#   nginx    <host> maint|proxy [port]  add /console/ to the yonder.zethai.cn server block (backup, nginx -t, reload)
#   uninstall <host> [--purge]  stop and remove the service; --purge also deletes user yonder and its data
# host defaults to zeth-root, ref to HEAD. Needs root ssh (BatchMode) on the server.
#
# Server layout (user yonder): ~/.local/share/yonder/runtime/<version>, runtime/current -> <version>,
# runtime/.previous (name of the prior version), runtime/bin/yonder, home in ~/.local/share/yonder/home.
# Node 24 ships inside each runtime (<version>/.node), so the system Node is untouched.
#
# Rollback steps per server change (what `install` touches):
#   - runtime/<version> is new; `rollback` flips `current` back, old versions are kept (last 3).
#   - user yonder / linger / unit dev.yonder.harness.service: `uninstall <host> --purge` removes them.
#   - home/ is created once and never overwritten except yonder.yaml, agents/main/agent.yaml,
#     and .yonder/auth.json (only when absent); previous copies are saved as *.pre-deploy-<stamp>.
set -euo pipefail

CMD=${1:-}
HOST=${2:-zeth-root}
REF=${3:-HEAD}
OUT=${YONDER_DEPLOY_OUT:-$HOME/.cache/yonder-deploy}
REPO=$(cd "$(dirname "$0")/.." && pwd)
IMAGE=${YONDER_BUILD_IMAGE:-node:24-bookworm-slim}
REMOTE_TMP=/var/tmp/yonder-deploy
SSH=(ssh -o BatchMode=yes)

die() { echo "deploy-node: $*" >&2; exit 1; }

version_of() { # <ref> -> <cli version>-<sha7>
	local v sha
	sha=$(git -C "$REPO" rev-parse --short=7 "$1^{commit}") || die "unknown ref $1"
	v=$(git -C "$REPO" show "$1:packages/cli/package.json" | sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' | head -n 1)
	[ -n "$v" ] || die "cannot read cli version at $1"
	echo "$v-$sha"
}

cmd_build() {
	local ver; ver=$(version_of "$REF")
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
	local ver; ver=$(version_of "$REF")
	[ -f "$OUT/yonder-$ver.tar.gz" ] || die "missing $OUT/yonder-$ver.tar.gz (run build first)"
	"${SSH[@]}" "$HOST" "mkdir -p $REMOTE_TMP && chmod 755 $REMOTE_TMP"
	"${SSH[@]}" "$HOST" "cat > $REMOTE_TMP/yonder-$ver.tar.gz.part && mv $REMOTE_TMP/yonder-$ver.tar.gz.part $REMOTE_TMP/yonder-$ver.tar.gz && chmod 644 $REMOTE_TMP/yonder-$ver.tar.gz" <"$OUT/yonder-$ver.tar.gz"
	COPYFILE_DISABLE=1 tar -C "$REPO/deploy/node" -czf - . | "${SSH[@]}" "$HOST" "cat > $REMOTE_TMP/config.tgz && chmod 644 $REMOTE_TMP/config.tgz"
	echo "pushed $ver to $HOST:$REMOTE_TMP"
}

# The key is read locally and sent over ssh stdin; it is never printed or stored in the repo.
local_glm_key() {
	python3 -c '
import json,os,sys
for p in ("~/.local/share/yonder-harness/home/.yonder/auth.json","~/.pi/agent/auth.json"):
    try:
        k=json.load(open(os.path.expanduser(p)))["rightapi-glm"]["key"]
    except Exception:
        continue
    if k and not k.startswith("!"):
        sys.stdout.write(k); sys.exit(0)
sys.exit(1)'
}

cmd_install() {
	local ver; ver=$(version_of "$REF")
	local key_flag
	if "${SSH[@]}" "$HOST" 'test -s /home/yonder/.local/share/yonder/home/.yonder/auth.json' 2>/dev/null; then key_flag=0; else key_flag=1; fi
	local key=""
	if [ "$key_flag" = 1 ]; then key=$(local_glm_key) || die "rightapi-glm key not found locally"; fi
	remote_install_script | "${SSH[@]}" "$HOST" "VER=$ver bash -s"
	if [ "$key_flag" = 1 ]; then
		printf '%s' "$key" | "${SSH[@]}" "$HOST" 'umask 077; d=/home/yonder/.local/share/yonder/home/.yonder; install -d -o yonder -g yonder -m 700 $d; python3 -c "
import json,sys
k=sys.stdin.read()
json.dump({\"rightapi-glm\":{\"type\":\"api_key\",\"key\":k}},open(\"$d/auth.json\",\"w\"))" ; chown yonder:yonder $d/auth.json; chmod 600 $d/auth.json'
		"${SSH[@]}" "$HOST" "runuser -u yonder -- env XDG_RUNTIME_DIR=/run/user/\$(id -u yonder) DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/\$(id -u yonder)/bus systemctl --user restart dev.yonder.harness.service"
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
	fi
done
Y mkdir -p "$HOMEDIR/.yonder"; Y chmod 700 "$HOMEDIR/.yonder"
cat > /home/yonder/.config/systemd/user/dev.yonder.harness.service <<EOU
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
chown yonder:yonder /home/yonder/.config/systemd/user/dev.yonder.harness.service
Y systemctl --user daemon-reload
Y systemctl --user enable dev.yonder.harness.service >/dev/null 2>&1
Y systemctl --user restart dev.yonder.harness.service
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
	"${SSH[@]}" "$HOST" 'bash -s' <<'EOS'
UIDY=$(id -u yonder) || exit 1
Y() { runuser -u yonder -- env HOME=/home/yonder XDG_RUNTIME_DIR=/run/user/$UIDY DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$UIDY/bus "$@"; }
R=/home/yonder/.local/share/yonder/runtime
echo "current:  $(readlink $R/current)"; echo "previous: $(cat $R/.previous 2>/dev/null)"
Y systemctl --user show dev.yonder.harness.service -p ActiveState,SubState,MainPID,MemoryCurrent,MemoryMax,MemorySwapMax,NRestarts
Y /home/yonder/.local/bin/yonder version 2>&1 | head -n 3
EOS
}

cmd_rollback() {
	"${SSH[@]}" "$HOST" 'bash -s' <<'EOS'
set -euo pipefail
UIDY=$(id -u yonder)
Y() { runuser -u yonder -- env HOME=/home/yonder XDG_RUNTIME_DIR=/run/user/$UIDY DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$UIDY/bus "$@"; }
R=/home/yonder/.local/share/yonder/runtime
prev=$(cat "$R/.previous" 2>/dev/null) || { echo "no previous runtime" >&2; exit 1; }
[ -d "$R/$prev" ] || { echo "previous runtime $prev is gone" >&2; exit 1; }
cur=$(readlink "$R/current"); cur=${cur##*/}
Y ln -sfn "$R/$prev" "$R/.current.new"; Y mv -T "$R/.current.new" "$R/current"
Y sh -c "echo $cur > $R/.previous"
Y systemctl --user restart dev.yonder.harness.service
echo "rolled back: $cur -> $prev"
EOS
}

# Adds only a marked `location /console/` block to /etc/nginx/conf.d/yonder.conf; nothing else is edited.
# Undo: restore the printed backup file and `nginx -s reload`, or rerun with `maint`.
cmd_nginx() {
	local mode=${3:-}; local port=${4:-}
	case "$mode" in maint|proxy) ;; *) die "nginx <host> maint|proxy [port]" ;; esac
	if [ "$mode" = proxy ]; then case "$port" in ''|*[!0-9]*) die "proxy needs a numeric port" ;; esac; fi
	"${SSH[@]}" "$HOST" "mkdir -p /usr/share/nginx/yonder-console && cat > /usr/share/nginx/yonder-console/index.html && chmod -R a+rX /usr/share/nginx/yonder-console" <"$REPO/deploy/node/maintenance.html"
	"${SSH[@]}" "$HOST" "MODE=$mode PORT=$port bash -s" <<'EOS'
set -euo pipefail
F=/etc/nginx/conf.d/yonder.conf
B=$F.bak-$(date +%Y%m%dT%H%M%SZ)
cp -p "$F" "$B"; echo "backup: $B"
python3 - "$F" <<'PY'
import os,re,sys
f=sys.argv[1]; s=open(f).read()
mode=os.environ["MODE"]; port=os.environ["PORT"]
s=re.sub(r"    # yonder-console begin\n.*?    # yonder-console end\n","",s,flags=re.S)
if mode=="maint":
    body="""    location = /console { return 308 /console/; }
    location /console/ {
        alias /usr/share/nginx/yonder-console/;
        index index.html;
        add_header Cache-Control "no-store" always;
    }
"""
else:
    body=f"""    location = /console {{ return 308 /console/; }}
    location /console/ {{
        proxy_pass http://127.0.0.1:{port}/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
        proxy_buffering off;
    }}
"""
block="    # yonder-console begin\n"+body+"    # yonder-console end\n"
marker="    location / {\n"
i=s.index(marker)
s=s[:i]+block+s[i:]
open(f,"w").write(s)
PY
if nginx -t 2>&1; then nginx -s reload && echo reloaded; else cp -p "$B" "$F"; echo "nginx -t failed, restored $B" >&2; exit 1; fi
EOS
}

cmd_uninstall() {
	"${SSH[@]}" "$HOST" "PURGE=${3:-} bash -s" <<'EOS'
set -u
id yonder >/dev/null 2>&1 || { echo "no user yonder"; exit 0; }
UIDY=$(id -u yonder)
Y() { runuser -u yonder -- env HOME=/home/yonder XDG_RUNTIME_DIR=/run/user/$UIDY DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$UIDY/bus "$@"; }
Y systemctl --user disable --now dev.yonder.harness.service
rm -f /home/yonder/.config/systemd/user/dev.yonder.harness.service
if [ "$PURGE" = "--purge" ]; then
	loginctl disable-linger yonder; pkill -u yonder || true; userdel -r yonder; rm -rf /var/tmp/yonder-deploy
fi
echo uninstalled
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
	*) sed -n '2,12p' "$0"; exit 2 ;;
esac
