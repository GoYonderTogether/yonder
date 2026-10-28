#!/usr/bin/env python3
"""Insert (or replace) a marked `location /console/` block into an nginx config.

Pure transform, testable standalone:
  env MODE=maint|proxy PORT=<port> ORIGIN_HOST=<host> python3 nginx-console.py <config>

Only the server block whose server_name matches ORIGIN_HOST is edited; the block is
wrapped in `# yonder-console begin/end` markers, so reruns are idempotent.
Exits non-zero without writing when no matching server block exists.
"""
import os
import re
import sys

MAINT_BODY = """    location = /console { return 308 /console/; }
    location /console/ {
        alias /usr/share/nginx/yonder-console/;
        index index.html;
        add_header Cache-Control "no-store" always;
    }
"""
PROXY_BODY = """    location = /console { return 308 /console/; }
    location /console/ {
        proxy_pass http://127.0.0.1:{port}/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
        proxy_buffering off;
    }
"""


def transform(text: str, mode: str, port: str, origin_host: str) -> str:
    body = MAINT_BODY if mode == "maint" else PROXY_BODY.replace("{port}", port)
    block = "    # yonder-console begin\n" + body + "    # yonder-console end\n"
    # Idempotent: drop any previous marked block first.
    text = re.sub(r"[ \t]*# yonder-console begin\n.*?[ \t]*# yonder-console end\n", "", text, flags=re.S)
    # Find server blocks and pick the one whose server_name matches origin_host.
    for m in re.finditer(r"(?m)^[ \t]*server\s*\{", text):
        start = m.end() - 1
        depth = 0
        i = start
        while i < len(text):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
                if depth == 0:
                    break
            i += 1
        if depth != 0:  # unbalanced; skip
            continue
        body = text[start:i]
        names = re.findall(r"server_name\s+([^;]+);", body)
        for entry in names:
            if origin_host in entry.split():
                close = text.rfind("}", start, i + 1)
                loc = re.search(r"(?m)^[ \t]*location\s", text[start:close])
                pos = start + loc.start() if loc else close
                return text[:pos] + block + text[pos:]
                return text[:i - 0] + "\n" + block.rstrip("\n") + "\n" + text[i:]
    raise LookupError(f"no server block with server_name {origin_host!r}")


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: nginx-console.py <config>", file=sys.stderr)
        return 2
    mode = os.environ.get("MODE", "")
    if mode not in ("maint", "proxy"):
        print("MODE must be maint or proxy", file=sys.stderr)
        return 2
    port = os.environ.get("PORT", "")
    if mode == "proxy" and not port.isdigit():
        print("proxy needs a numeric PORT", file=sys.stderr)
        return 2
    origin_host = os.environ.get("ORIGIN_HOST", "")
    if not origin_host:
        print("ORIGIN_HOST is required", file=sys.stderr)
        return 2
    with open(sys.argv[1]) as f:
        text = f.read()
    try:
        result = transform(text, mode, port, origin_host)
    except LookupError as e:
        print(f"nginx-console: {e}", file=sys.stderr)
        return 1
    with open(sys.argv[1], "w") as f:
        f.write(result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
