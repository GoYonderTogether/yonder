"""一次性清理：把已存储的图片块从 pi 转录里换成一个小的文字占位。

只在维护者明确要求时运行。它会原地改写 state.db 的 pi_entries / pi_tasks 两列，
运行前必须停止服务并做好备份。不新增 CLI 命令，也不改产品代码的行为。
"""

import json
import os
import re
import sqlite3
import sys

PATH_RE = re.compile(r'"(?:path|file|artifact)"\s*:\s*"([^"]+\.(?:png|jpe?g|gif|webp|bmp))"', re.I)
BARE_PATH = re.compile(r"(/[^\s\"'()]+\.(?:png|jpe?g|gif|webp|bmp))", re.I)


def placeholder(block, text):
    mime = block.get("mimeType") or "image"
    size = len(block.get("data") or "")
    found = PATH_RE.search(text) or BARE_PATH.search(text)
    path = found.group(1) if found else None
    where = f"：{path}" if path else ""
    return f"[原图已清理（{mime}，base64 {size // 1024} KB）{where}]"


def rewrite(value, sibling_text=""):
    """返回 (新值, 替换张数)。递归处理 dict/list，只改 type == image 的块。"""
    removed = 0
    if isinstance(value, list):
        # 同一个内容数组里的文字块通常写着产物路径，先收集起来给占位用。
        text = " ".join(
            item.get("text", "")
            for item in value
            if isinstance(item, dict) and item.get("type") == "text" and isinstance(item.get("text"), str)
        )
        out = []
        for item in value:
            new, n = rewrite(item, text)
            removed += n
            out.append(new)
        return out, removed
    if isinstance(value, dict):
        if value.get("type") == "image" and isinstance(value.get("data"), str):
            return {"type": "text", "text": placeholder(value, sibling_text)}, 1
        out = {}
        for key, item in value.items():
            new, n = rewrite(item, sibling_text)
            removed += n
            out[key] = new
        return out, removed
    return value, 0


def main():
    db_path = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser(
        "~/.local/share/yonder/home/.yonder/state.db"
    )
    apply = "--apply" in sys.argv
    con = sqlite3.connect(db_path)
    total_rows = total_blocks = 0
    bytes_before = bytes_after = 0
    for table, column in (("pi_entries", "record"), ("pi_tasks", "record")):
        rows = con.execute(
            f"SELECT rowid, {column} FROM {table} WHERE {column} LIKE '%\"type\":\"image\"%'"
        ).fetchall()
        for rowid, raw in rows:
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue
            new, n = rewrite(data)
            if not n:
                continue
            encoded = json.dumps(new, ensure_ascii=False, separators=(",", ":"))
            total_rows += 1
            total_blocks += n
            bytes_before += len(raw.encode())
            bytes_after += len(encoded.encode())
            if apply:
                con.execute(f"UPDATE {table} SET {column} = ? WHERE rowid = ?", (encoded, rowid))
    if apply:
        con.commit()
        con.execute("VACUUM")
    con.close()
    mode = "已写入" if apply else "仅预览（加 --apply 才写）"
    print(
        f"{mode}：{total_rows} 行，{total_blocks} 张图片；"
        f"{bytes_before / 1e6:.1f} MB -> {bytes_after / 1e6:.1f} MB"
    )


if __name__ == "__main__":
    main()
