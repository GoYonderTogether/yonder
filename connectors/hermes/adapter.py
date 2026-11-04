"""The only file that calls Hermes's session APIs (spec 23 §4).

Hermes exposes its sessions two ways:

- the `api_server` platform's REST surface (`/api/sessions*`, `/v1/runs*`),
  Bearer-authenticated with `API_SERVER_KEY` on loopback; and
- the gateway's own in-process event stream (the adapter lives inside the
  gateway process, so live turn events arrive through the shared server
  transport), reduced here to the connector's update vocabulary.

Everything version-dependent — URL shapes, field names, event names — lives
in this file; callers deal in `HarnessSession` / `HarnessUpdate` /
`SessionEvent`, never in Hermes wire shapes. Method-signature changes across
Hermes releases are fixed here and only here (spec 23 §4).
"""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass
from typing import Any, Callable, Optional
from urllib.parse import quote
from urllib.request import Request, build_opener, ProxyHandler

API_TIMEOUT_S = 20.0


@dataclass
class HarnessSession:
    id: str
    updated_at: float
    title: Optional[str] = None
    source: Optional[str] = None
    message_count: int = 0
    preview: Optional[str] = None


@dataclass
class HarnessTranscriptItem:
    id: int
    kind: str
    text: str
    timestamp: Optional[float] = None

    def to_dict(self) -> dict:
        out: dict[str, Any] = {"id": self.id, "kind": self.kind, "text": self.text}
        if self.timestamp is not None:
            out["timestamp"] = self.timestamp
        return out


@dataclass
class HarnessUpdate:
    type: str  # "message" | "state" | "error"
    text: Optional[str] = None
    running: Optional[bool] = None
    streaming: bool = False

    def to_dict(self) -> dict:
        out: dict[str, Any] = {"type": self.type}
        if self.text is not None:
            out["text"] = self.text
        if self.running is not None:
            out["running"] = self.running
        if self.streaming:
            out["streaming"] = True
        return out


@dataclass
class SessionEvent:
    """One event from the gateway's shared transport, already reduced to the
    facts the connector consumes."""
    session_id: str
    type: str
    payload: Any = None


def info_of(session: HarnessSession) -> dict:
    """Session facts the web client needs; transcript bodies stay in Hermes
    (invariant 4: 不复制 harness 转录)."""
    out: dict[str, Any] = {
        "id": session.id,
        "agent": None,
        "profile": session.source or "default",
        "mode": "task",
        "key": session.id,
        "version": "1",
        "opened": _iso(session.updated_at),
    }
    if session.title:
        out["title"] = session.title
    return out


def snapshot_of(session: HarnessSession, transcript: dict) -> dict:
    info = info_of(session)
    return {
        "session": info,
        "info": {"session": info, "config": {}, "usage": {}, "skills": {}},
        "transcript": transcript,
    }


def _iso(seconds: float) -> str:
    from datetime import datetime, timezone

    return datetime.fromtimestamp(seconds / 1000.0, tz=timezone.utc).isoformat()


def _seconds(value: Any) -> float:
    """Hermes reports epoch seconds; the connector projects epoch milliseconds."""
    if isinstance(value, (int, float)) and value > 0:
        return value * 1000.0 if value < 10_000_000_000 else float(value)
    return time.time() * 1000.0


def _message_text(message: dict) -> str:
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text" and isinstance(block.get("text"), str):
                parts.append(block["text"])
        return "\n".join(parts)
    if isinstance(content, dict) and isinstance(content.get("text"), str):
        return content["text"]
    return ""


def _transcript_items(messages: list[dict]) -> list[HarnessTranscriptItem]:
    items: list[HarnessTranscriptItem] = []
    for message in messages:
        role = message.get("role")
        row_id = message.get("id")
        if not isinstance(row_id, int):
            continue
        if role in ("user", "assistant"):
            text = _message_text(message)
            if text.strip():
                items.append(HarnessTranscriptItem(
                    id=row_id,
                    kind="yonder.message" if role == "user" else "pi.assistant",
                    text=text,
                    timestamp=message.get("timestamp") if isinstance(message.get("timestamp"), (int, float)) else None,
                ))
        elif role == "tool":
            summary = message.get("summary") if isinstance(message.get("summary"), str) else _message_text(message)
            if summary and summary.strip():
                items.append(HarnessTranscriptItem(id=row_id, kind="pi.tool-result", text=summary))
    return items


class HarnessService:
    """Session driving over Hermes's own REST + event surfaces (spec 23 §3:
    只经进程内接口或官方对外接口，不直接读写会话存储文件)."""

    def __init__(self, base_url: str, api_key: str, log: Callable[[str], None]) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self._log = log
        self._watchers: dict[str, "_Watcher"] = {}
        self._event_listeners: list[Callable[[SessionEvent], None]] = []
        self._active: dict[str, set] = {}

    # ---- REST plumbing (stdlib only; aiohttp is the server's, not ours) ----

    def _request(self, method: str, path: str, body: Any = None) -> Any:
        headers = {"authorization": f"Bearer {self.api_key}"}
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            headers["content-type"] = "application/json"
        request = Request(f"{self.base_url}{path}", data=data, headers=headers, method=method)
        # The api_server is loopback; a system proxy must not intercept it.
        opener = build_opener(ProxyHandler({}))
        with opener.open(request, timeout=API_TIMEOUT_S) as response:
            payload = response.read()
        return json.loads(payload) if payload else None

    async def _request_async(self, method: str, path: str, body: Any = None) -> Any:
        return await asyncio.get_running_loop().run_in_executor(
            None, self._request, method, path, body)

    # ---- HarnessService contract ----

    async def list(self) -> list[HarnessSession]:
        payload = await self._request_async("GET", "/api/sessions?limit=200")
        rows = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(rows, list):
            return []
        sessions = []
        for row in rows:
            if not isinstance(row, dict) or not isinstance(row.get("id"), str):
                continue
            sessions.append(HarnessSession(
                id=row["id"],
                updated_at=_seconds(row.get("last_active") or row.get("started_at") or 0),
                title=row.get("title") or None,
                source=row.get("source") or None,
                message_count=row.get("message_count") or 0,
                preview=row.get("preview") or None,
            ))
        return sessions

    async def show(self, session_id: str) -> Optional[HarnessSession]:
        try:
            payload = await self._request_async("GET", f"/api/sessions/{quote(session_id)}")
        except Exception:
            return None
        session = payload.get("session") if isinstance(payload, dict) else None
        if not isinstance(session, dict) or not isinstance(session.get("id"), str):
            return None
        return HarnessSession(
            id=session["id"],
            updated_at=_seconds(session.get("last_active") or session.get("started_at") or 0),
            title=session.get("title") or None,
            source=session.get("source") or None,
            message_count=session.get("message_count") or 0,
        )

    async def exists(self, session_id: str) -> bool:
        return await self.show(session_id) is not None

    async def create(self, options: Optional[dict] = None) -> dict:
        body: dict[str, Any] = {"source": "api_server"}
        options = options or {}
        if isinstance(options.get("title"), str) and options["title"].strip():
            body["title"] = options["title"]
        payload = await self._request_async("POST", "/api/sessions", body)
        session = payload.get("session") if isinstance(payload, dict) else None
        if not isinstance(session, dict) or not isinstance(session.get("id"), str):
            raise RuntimeError("Hermes created no session id")
        return {"sessionId": session["id"]}

    async def submit(self, session_id: str, text: str) -> None:
        """One turn into the session via `POST /v1/runs` (admission, not
        completion: spec 23 §2.4). The turn's events reach the reply and watch
        paths through the shared gateway event stream (`follow`)."""
        payload = await self._request_async("POST", "/v1/runs", {
            "session_id": session_id, "input": text,
        })
        run_id = payload.get("run_id") if isinstance(payload, dict) else None
        if not isinstance(run_id, str) or not run_id:
            raise RuntimeError("Hermes did not accept the run")
        self._active.setdefault(session_id, set()).add(run_id)

    async def transcript(self, session_id: str, limit: int, before: Optional[int]) -> dict:
        payload = await self._request_async(
            "GET", f"/api/sessions/{quote(session_id)}/messages?limit={limit}&order=oldest")
        rows = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(rows, list):
            return {"items": [], "hasMore": False}
        items = [item.to_dict() for item in _transcript_items(rows)]
        if before is not None:
            items = [item for item in items if item["id"] < before]
        return {"items": items, "hasMore": False}

    async def abort(self, session_id: str) -> None:
        """Stop this session's active runs; nothing else (spec 23 §2.4)."""
        for run_id in list(self._active.get(session_id, ())):
            try:
                await self._request_async("POST", f"/v1/runs/{quote(run_id)}/stop", {})
            except Exception as error:
                self._log(f"中止运行 {run_id} 失败：{error}")
            finally:
                self._active.get(session_id, set()).discard(run_id)

    async def follow(self, session_id: str, on_update: Callable[[HarnessUpdate], None]) -> Callable[[], Any]:
        """Subscribe to one session's live updates; events arrive through the
        shared gateway transport because the adapter runs inside the gateway
        process. Closing the returned function removes the subscription but
        never cancels the Hermes turn (spec 23 §2.4)."""
        watcher = _Watcher(session_id, on_update)
        self._watchers[session_id] = watcher
        return lambda: self._unfollow(session_id, watcher)

    def _unfollow(self, session_id: str, watcher: "_Watcher") -> None:
        if self._watchers.get(session_id) is watcher:
            self._watchers.pop(session_id, None)

    # ---- event reduction ----

    def add_event_listener(self, listener: Callable[[SessionEvent], None]) -> None:
        """BotBridge reply observation rides the same reduced stream."""
        self._event_listeners.append(listener)

    def emit_event(self, event: SessionEvent) -> None:
        """One gateway event, reduced to zero or more connector updates. The
        only Hermes-shape-aware part of the event path."""
        payload = event.payload if isinstance(event.payload, dict) else {}
        updates: list[HarnessUpdate] = []
        if event.type == "message.start":
            updates.append(HarnessUpdate(type="state", running=True))
        elif event.type == "message.delta":
            text = payload.get("text") if isinstance(payload.get("text"), str) else ""
            if text:
                updates.append(HarnessUpdate(type="message", text=text, streaming=True))
        elif event.type == "message.complete":
            text = payload.get("text") if isinstance(payload.get("text"), str) else ""
            updates.append(HarnessUpdate(type="message", text=text, streaming=False))
            updates.append(HarnessUpdate(type="state", running=False))
            for run_id in list(self._active.get(event.session_id, ())):
                self._active.get(event.session_id, set()).discard(run_id)
        elif event.type == "error":
            text = payload.get("message") if isinstance(payload.get("message"), str) else "error"
            updates.append(HarnessUpdate(type="error", text=text))
        elif event.type == "session.info":
            running = payload.get("running")
            if isinstance(running, bool):
                updates.append(HarnessUpdate(type="state", running=running))
        for update in updates:
            watcher = self._watchers.get(event.session_id)
            if watcher is not None:
                try:
                    watcher.on_update(update)
                except Exception:
                    pass
            reduced = SessionEvent(event.session_id, update.type, update.to_dict())
            for listener in list(self._event_listeners):
                try:
                    listener(reduced)
                except Exception:
                    pass


class _Watcher:
    def __init__(self, session_id: str, on_update: Callable[[HarnessUpdate], None]) -> None:
        self.session_id = session_id
        self.on_update = on_update
