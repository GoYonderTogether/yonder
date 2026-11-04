"""Device-channel frames this connector speaks (spec 23 §2).

The connector implements a subset of the existing `/ws/device` protocol;
anything not listed here is ignored rather than treated as a protocol error.
This is the Python twin of `connectors/dsh/src/frames.ts` — the wire subset is
identical, so the cloud and web clients need no per-framework branch.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Optional

UUID = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE
)

# Work methods this connector implements (spec 23 §2.4); anything else answers
# `unsupported` instead of timing out.
WORK_METHODS = (
    "sessions.list",
    "sessions.open",
    "sessions.submit",
    "sessions.transcript",
    "sessions.abort",
)


@dataclass
class CloudMessage:
    id: str
    conv_id: str
    seq: int
    sender_id: str
    content: dict
    created_at: float
    reply_to: Optional[str] = None
    sender_name: Optional[str] = None
    sender_is_bot: Optional[bool] = None


@dataclass
class InboundFrame:
    type: str
    agent_id: Optional[str] = None
    conv_id: Optional[str] = None
    conv_kind: Optional[str] = None
    mentioned: bool = False
    replayed: bool = False
    message: Optional[CloudMessage] = None
    ref: Optional[str] = None
    error: Optional[str] = None
    request_id: Optional[str] = None
    owner_id: Optional[str] = None
    device_id: Optional[str] = None
    method: Optional[str] = None
    params: Any = None
    channel_id: Optional[str] = None
    frame: Any = None


def is_uuid(value: Any) -> bool:
    return isinstance(value, str) and bool(UUID.match(value))


def _cloud_message(value: Any) -> Optional[CloudMessage]:
    if not isinstance(value, dict):
        return None
    for key in ("id", "convId", "seq", "senderId", "content", "createdAt"):
        if key not in value:
            return None
    if not isinstance(value["seq"], (int, float)):
        return None
    if not isinstance(value["content"], dict):
        return None
    content_type = value["content"].get("type")
    if content_type not in ("text", "markdown", "error", "interactive", "image", "file"):
        return None
    if content_type in ("text", "markdown", "error") and not isinstance(value["content"].get("text"), str):
        return None
    return CloudMessage(
        id=value["id"],
        conv_id=value["convId"],
        seq=value["seq"],
        sender_id=value["senderId"],
        content=value["content"],
        created_at=value["createdAt"],
        reply_to=value.get("replyTo") if isinstance(value.get("replyTo"), str) else None,
        sender_name=value.get("senderName") if isinstance(value.get("senderName"), str) else None,
        sender_is_bot=value.get("senderIsBot") if isinstance(value.get("senderIsBot"), bool) else None,
    )


def parse_frame(raw: Any) -> Optional[InboundFrame]:
    """Parse one frame; None for anything the connector does not implement."""
    value = raw
    if isinstance(raw, (str, bytes)):
        try:
            value = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            return None
    if not isinstance(value, dict):
        return None
    kind = value.get("type")
    if kind == "message":
        if not isinstance(value.get("agentId"), str) or not isinstance(value.get("convId"), str):
            return None
        message = _cloud_message(value.get("message"))
        if message is None or value.get("convKind") not in ("dm", "group", "notice"):
            return None
        return InboundFrame(
            type="message", agent_id=value["agentId"], conv_id=value["convId"],
            conv_kind=value["convKind"], mentioned=value.get("mentioned") is True,
            replayed=value.get("replayed") is True, message=message,
        )
    if kind == "sent":
        message = _cloud_message(value.get("message"))
        if message is None:
            return None
        return InboundFrame(type="sent", message=message,
                            ref=value.get("ref") if isinstance(value.get("ref"), str) else None)
    if kind == "error":
        # The backend's error frame carries no ref; unconfirmed, never success.
        return InboundFrame(type="error",
                            error=value.get("error") if isinstance(value.get("error"), str) else "error")
    if kind in ("work.request", "work.cancel"):
        if not all(isinstance(value.get(k), str) for k in ("requestId", "ownerId", "deviceId")):
            return None
        if kind == "work.request" and not isinstance(value.get("method"), str):
            return None
        return InboundFrame(
            type=kind, request_id=value["requestId"], owner_id=value["ownerId"],
            device_id=value["deviceId"],
            method=value.get("method"), params=value.get("params"),
        )
    if kind in ("work.open", "work.frame", "work.close"):
        if not isinstance(value.get("channelId"), str):
            return None
        return InboundFrame(
            type=kind, channel_id=value["channelId"],
            owner_id=str(value.get("ownerId")), device_id=str(value.get("deviceId")),
            frame=value.get("frame"),
        )
    return None


# Gateway-shaped frame the connector relays inside `work.event` (spec 19 §3).
@dataclass
class StreamFrame:
    t: str
    sub: Optional[str] = None
    seq: Optional[int] = None
    cursor: str = ""
    gap: Optional[bool] = None
    result: Any = None
    type: Optional[str] = None
    ts: Optional[str] = None
    data: Any = None
    reason: Optional[str] = None
    error: Any = None
    n: Optional[int] = None

    def to_dict(self) -> dict:
        out: dict[str, Any] = {"t": self.t}
        if self.sub is not None:
            out["sub"] = self.sub
        if self.seq is not None:
            out["seq"] = self.seq
        if self.t == "ready":
            out.update({"gap": bool(self.gap), "cursor": self.cursor, "result": self.result})
        elif self.t == "ev":
            out.update({"cursor": self.cursor, "type": self.type, "ts": self.ts, "data": self.data})
        elif self.t == "end":
            out["reason"] = self.reason
            if self.error is not None:
                out["error"] = self.error
        elif self.t == "pong" and self.n is not None:
            out["n"] = self.n
        return out


def parse_stream_frame(value: Any) -> Optional[dict]:
    if not isinstance(value, dict) or not isinstance(value.get("t"), str):
        return None
    return value
