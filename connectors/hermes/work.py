"""Work bridge (spec 23 §2.4): request/response for the five session methods and
the `sessions.watch` subscription relayed inside `work.open`/`work.frame`/
`work.event`. Frames are the gateway's own shapes so the web client needs no
special case. Python twin of `connectors/dsh/src/work.ts`.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Optional

from .adapter import HarnessService, HarnessUpdate, info_of, snapshot_of
from .connection import CloudConnection
from .frames import InboundFrame, StreamFrame, WORK_METHODS

MAX_SUBS = 64


class UnsupportedMethod(Exception):
    code = "unsupported"

    def __init__(self, method: str) -> None:
        super().__init__(f"Method {method} is not supported by the Yonder Hermes connector")
        self.method = method


class InvalidParams(Exception):
    code = "invalid_params"


class NotFound(Exception):
    code = "not_found"

    def __init__(self, id: str) -> None:
        super().__init__(f"Unknown session: {id}")
        self.id = id


class WorkBridge:
    def __init__(
        self,
        harness: HarnessService,
        connection: CloudConnection,
        node_id: str = "",
        node_name: str = "",
    ) -> None:
        self.harness = harness
        self.connection = connection
        self.node_id = node_id
        self.node_name = node_name
        self._requests: dict[str, asyncio.Event] = {}
        # channelId -> {sub: _Subscription}
        self._channels: dict[str, dict[str, "_Subscription"]] = {}
        # Strong refs: a task nobody holds can be collected mid-run (asyncio).
        self._tasks: set[asyncio.Task] = set()

    def _spawn(self, coro) -> None:
        task = asyncio.get_running_loop().create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    def handle(self, frame: InboundFrame) -> bool:
        if frame.type == "work.request":
            self._spawn(self._request(frame))
            return True
        if frame.type == "work.cancel":
            event = self._requests.get(frame.request_id or "")
            if event is not None:
                event.set()
            return True
        if frame.type == "work.open":
            self._channels.setdefault(frame.channel_id or "", {})
            return True
        if frame.type == "work.frame":
            self._frame(frame.channel_id or "", frame.frame)
            return True
        if frame.type == "work.close":
            self.close(frame.channel_id or "")
            return True
        return False

    async def _request(self, frame: InboundFrame) -> None:
        request_id = frame.request_id or ""
        if request_id in self._requests:
            return
        event = asyncio.Event()
        self._requests[request_id] = event
        try:
            result = await self._call(frame.method or "", frame.params, event)
            self.connection.send({
                "type": "work.response", "requestId": request_id, "ok": True, "result": result,
            })
        except Exception as error:
            code = getattr(error, "code", "error")
            self.connection.send({
                "type": "work.response", "requestId": request_id, "ok": False,
                "error": {"code": code, "message": str(error) or "error"},
            })
        finally:
            self._requests.pop(request_id, None)

    async def _call(self, method: str, params: Any, cancel: asyncio.Event) -> Any:
        input = params if isinstance(params, dict) else {}
        if method == "capabilities.get":
            return self._facts()
        if method == "sessions.list":
            rows = await self.harness.list()
            return [info_of(row) for row in rows]
        if method == "sessions.open":
            id = input.get("id")
            if isinstance(id, str) and id:
                session = await self.harness.show(id)
                if session is None:
                    raise NotFound(id)
                return info_of(session)
            created = await self.harness.create({
                key: input[key] for key in ("cwd", "title") if isinstance(input.get(key), str)
            })
            session = await self.harness.show(created["sessionId"])
            if session is None:
                raise RuntimeError("The harness created no session")
            return info_of(session)
        if method == "sessions.submit":
            id = _required_id(input.get("id"))
            text = input.get("text") if isinstance(input.get("text"), str) else ""
            if not text.strip():
                raise InvalidParams("text is required")
            await self.harness.submit(id, text)
            return {"event": "session.input", "session": id}
        if method == "sessions.transcript":
            id = _required_id(input.get("id"))
            limit = _integer(input.get("limit"), 50, 1, 500)
            before = input.get("before")
            before = int(before) if isinstance(before, (int, float)) else None
            return await self.harness.transcript(id, limit=limit, before=before)
        if method == "sessions.abort":
            await self.harness.abort(_required_id(input.get("id")))
            return {"ok": True}
        if method in WORK_METHODS:
            raise UnsupportedMethod(method)  # known family, not implemented here
        # A method this connector does not implement is reported as such,
        # never left to time out (spec 23 §2.4).
        raise UnsupportedMethod(method)

    def _facts(self) -> dict:
        return {
            "protocol": 1,
            "minor": 1,
            "kind": "remote",
            "version": {"yonder": "hermes-connector", "commit": None},
            "node": {"id": self.node_id, "name": self.node_name},
            "methods": {
                "capabilities.get": {"scope": "read", "since": 1},
                "sessions.list": {"scope": "read", "since": 1},
                "sessions.open": {"scope": "write", "since": 1},
                "sessions.submit": {"scope": "write", "since": 1},
                "sessions.transcript": {"scope": "read", "since": 1},
                "sessions.abort": {"scope": "write", "since": 1},
                "sessions.watch": {"scope": "read", "stream": True, "since": 1},
            },
            "events": ["session.update"],
            "plugins": [],
            "granted": ["read", "write", "owner"],
            "views": [],
            "models": {"select": False},
            "remoteSession": {"create": True, "modes": ["task"], "agents": [], "workspaces": False},
            "limits": {"maxSubs": MAX_SUBS, "attachmentMaxBytes": 0, "transcriptPage": 50},
            "features": {
                "requestIdDedupe": False, "resumableWatch": False, "attachments": False,
                "notifications": False, "approvals": False, "suggestions": False,
            },
            "auth": {"kind": "remote", "owner": True},
        }

    # ---- one gateway-shaped stream relayed inside the device channel ----

    def _frame(self, channel_id: str, value: Any) -> None:
        subs = self._channels.get(channel_id)
        if subs is None or not isinstance(value, dict):
            return
        if value.get("t") == "ping":
            self._event(channel_id, StreamFrame(t="pong", n=value.get("n")))
            return
        sub = value.get("sub")
        if not isinstance(sub, str):
            return
        if value.get("t") == "unsub":
            self._end(channel_id, sub, "unsub")
            return
        if value.get("t") != "sub":
            return
        if value.get("method") != "sessions.watch":
            self._end(channel_id, sub, "error", UnsupportedMethod(str(value.get("method"))))
            return
        if sub in subs or len(subs) >= MAX_SUBS:
            self._end(channel_id, sub, "error", RuntimeError("too many subscriptions"))
            return
        entry = _Subscription()
        subs[sub] = entry
        self._spawn(self._subscribe(channel_id, sub, value.get("params")))

    async def _subscribe(self, channel_id: str, sub: str, params: Any) -> None:
        subs = self._channels.get(channel_id)
        if subs is None:
            return
        entry = subs.get(sub)
        if entry is None:
            return
        input = params if isinstance(params, dict) else {}
        id = input.get("id")
        if not isinstance(id, str) or not id:
            self._end(channel_id, sub, "error", InvalidParams("id is required"))
            return
        entry.id = id

        def emit(update: HarnessUpdate) -> None:
            if entry.stopped or self._channels.get(channel_id) is not subs:
                return
            if entry.ready:
                self._send_update(channel_id, sub, entry, update)
            elif len(entry.queued) < 500:
                entry.queued.append(update)

        try:
            session = await self.harness.show(id)
            if session is None:
                raise NotFound(id)
            transcript = await self.harness.transcript(id, limit=50, before=None)
            stop = await self.harness.follow(id, emit)
            entry.stop = stop
            # The bridge never promises a durable cursor: every subscription
            # opens from the live snapshot, so `gap` is always true (spec 19 §3).
            self._event(channel_id, StreamFrame(
                t="ready", sub=sub, gap=True, cursor="",
                result=snapshot_of(session, transcript),
            ))
            entry.ready = True
            for update in entry.queued:
                self._send_update(channel_id, sub, entry, update)
            entry.queued.clear()
        except Exception as error:
            self._end(channel_id, sub, "error", error)

    def _send_update(self, channel_id: str, sub: str, entry: "_Subscription", update: HarnessUpdate) -> None:
        entry.seq += 1
        self._event(channel_id, StreamFrame(
            t="ev", sub=sub, seq=entry.seq, cursor="",
            type="session.update", ts=_now_iso(),
            data=update.to_dict() if isinstance(update, HarnessUpdate) else update,
        ))

    def _event(self, channel_id: str, frame: StreamFrame) -> None:
        if channel_id not in self._channels:
            return
        self.connection.send({"type": "work.event", "channelId": channel_id, "frame": frame.to_dict()})

    def _end(self, channel_id: str, sub: str, reason: str, error: Exception | None = None) -> None:
        subs = self._channels.get(channel_id)
        if subs is None:
            return
        entry = subs.pop(sub, None)
        if entry is not None:
            entry.stopped = True
            if entry.stop is not None:
                try:
                    stop = entry.stop()
                    if asyncio.iscoroutine(stop):
                        asyncio.get_running_loop().create_task(_await_quietly(stop))
                except Exception:
                    pass
        payload: dict = {"t": "end", "sub": sub, "reason": reason}
        if reason == "error":
            payload["error"] = {
                "code": getattr(error, "code", "error"),
                "message": str(error) if error is not None else "error",
            }
        self._event(channel_id, StreamFrame(**payload))

    def close(self, channel_id: str) -> None:
        subs = self._channels.pop(channel_id, None)
        if not subs:
            return
        for sub in list(subs):
            self._end(channel_id, sub, "closed")

    def stop(self) -> None:
        for channel_id in list(self._channels):
            self.close(channel_id)
        for event in self._requests.values():
            event.set()
        self._requests.clear()


class _Subscription:
    def __init__(self) -> None:
        self.id: str = ""
        self.ready = False
        self.stopped = False
        self.queued: list[HarnessUpdate] = []
        self.seq = 0
        self.stop: Optional[Callable[[], Any]] = None


async def _await_quietly(coro: Any) -> None:
    try:
        await coro
    except Exception:
        pass


def _required_id(value: Any) -> str:
    if not isinstance(value, str) or not value:
        raise InvalidParams("id is required")
    return value


def _integer(value: Any, fallback: int, minimum: int, maximum: int) -> int:
    if not isinstance(value, (int, float)):
        return fallback
    return min(maximum, max(minimum, int(value)))


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
