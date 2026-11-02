#!/bin/sh
# 用 Yonder 的阿里云凭据运行 aliyun CLI，不把 AK 落盘。
#
#   scripts/cloud/aliyun.sh oss ls
#   scripts/cloud/aliyun.sh oss cp <文件> oss://yonder-release/android/yonder-<version>.apk
#
# 凭据来自 agent-vault（默认条目见下），只在本次调用的临时目录里生成 0600 配置；
# 退出时删除。机器上没有 agent-vault 或条目时如实失败，不回落到明文配置。
#
# 覆盖项：YONDER_ALIYUN_VAULT_ITEM、YONDER_ALIYUN_REGION、YONDER_ALIYUN_BIN。
set -eu
ENTRY=${YONDER_ALIYUN_VAULT_ITEM:-8d629a0a-fb7e-4f8b-8d99-c814af248b99}
REGION=${YONDER_ALIYUN_REGION:-cn-hangzhou}
BIN=${YONDER_ALIYUN_BIN:-$(command -v aliyun || true)}
[ -n "$BIN" ] || { echo "aliyun CLI 不在 PATH；装好后重试" >&2; exit 1; }
command -v agent-vault >/dev/null || { echo "agent-vault 不在 PATH；没有凭据就不伪造调用" >&2; exit 1; }
DIR=$(mktemp -d)
trap 'rm -rf "$DIR"' EXIT INT TERM
cat > "$DIR/refs.env" <<EOF
AK=vw://automation/$ENTRY/field:OSS_ACCESS_KEY_ID
SK=vw://automation/$ENTRY/field:OSS_ACCESS_KEY_SECRET
EOF
cat > "$DIR/run.sh" <<'RUN'
set -eu
umask 077
printf '{"current":"default","profiles":[{"name":"default","mode":"AK","access_key_id":"%s","access_key_secret":"%s","region_id":"%s"}],"meta_path":""}' \
  "$AK" "$SK" "$REGION_ID" > "$CFG_PATH"
exec "$@" --config-path "$CFG_PATH"
RUN
CFG_PATH="$DIR/config.json" REGION_ID="$REGION" \
  exec agent-vault run "$DIR/refs.env" -- sh "$DIR/run.sh" "$BIN" "$@"
