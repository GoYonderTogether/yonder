"""Bot side of the device channel: registers the harness's agents as Bots,
delivers cloud messages into harness conversations, and returns the harness's
replies. It keeps no transcript: the harness owns the record (invariant 4).
Python twin of `connectors/dsh/src/bots.ts`.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Awaitable, Callable, Optional

from .adapter import SessionEvent
from .connection import CloudConnection
from .frames import CloudMessage, InboundFrame

SEND_TIMEOUT_S = 15.0
AGENT_SYNC_S = 600.0


class BotBridge:
    def __init__(
        self,
        harness: Any,
        connection: CloudConnection,
        api: Any,
        agents: Callable[[], Any],
        on_ack: Callable[[str, str, int], None],
        cursor: Callable[[str, str], Optional[int]],
        bind_session: Callable[[str, str], None],
        session_for: Callable[[str], Optional[str]],
        unbind_session: Callable[[str], None],
        log: Callable[[str], None],
    ) -> None:
        self.harness = harness
        self.connection = connection
        self.api = api
        self._agents = agents
        self._on_ack = on_ack
        self._cursor = cursor
        self._bind_session = bind_session
        self._session_for = session_for
        self._unbind_session = unbind_session
        self._log = log
        self._pending: dict[str, asyncio.Future] = {}
        self._replies: dict[str, dict] = {}
        self.bot_agents: list[dict] = []
        self._sync_task: Optional[asyncio.Task] = None
        self._stopped = False

    async def start(self) -> None:
        try:
            await self.sync_agents()
        except Exception:
            import logging

            logging.getLogger(__name__).warning(
                "[Yonder] Bot 登记失败（连接保持，稍后重试）", exc_info=True)
        self.connection.start()
        self._sync_task = asyncio.get_running_loop().create_task(self._sync_loop())

    async def _sync_loop(self) -> None:
        while not self._stopped:
            await asyncio.sleep(AGENT_SYNC_S)
            try:
                await self.sync_agents()
            except Exception:
                pass

    async def sync_agents(self) -> None:
        """Full-list reconciliation: keys this device stops reporting are retired
        by the cloud (spec 23 §2.2)."""
        if self._stopped:
            return
        rows = list(await self._agents())
        # An empty list means the harness could not enumerate agents; reporting
        # it would retire every Bot.
        if not rows:
            self._log("未能枚举 harness 的 agent 列表；本轮不登记（避免云端退役全部 Bot）。")
            return
        payload = [{"key": row["key"], "name": row["name"], "avatarUrl": None} for row in rows]
        self.bot_agents = await self.api.put_agents(payload)
        self._log(f"已登记 Bot {len(self.bot_agents)} 个：{'、'.join(row['key'] for row in self.bot_agents)}。")

    def handle(self, frame: InboundFrame) -> bool:
        if frame.type == "sent":
            if frame.ref:
                self._settle(frame.ref)
            return True
        if frame.type == "error":
            if frame.ref:
                self._fail(frame.ref)
            return True
        if frame.type != "message":
            return False
        asyncio.get_running_loop().create_task(self._deliver(frame))
        return True

    def _settle(self, ref: str) -> None:
        future = self._pending.pop(ref, None)
        if future is not None and not future.done():
            future.set_result(True)

    def _fail(self, ref: str) -> None:
        future = self._pending.pop(ref, None)
        if future is not None and not future.done():
            future.set_result(False)

    async def send(self, agent_id: str, conv_id: str, content: dict) -> bool:
        """Send one Bot message and wait for the cloud's `sent`; anything else is
        unconfirmed and never retried (spec 16 §3)."""
        ref = f"{agent_id}:{conv_id}:{time.time():.0f}:{id(self) & 0xffffff:x}"
        future: asyncio.Future = asyncio.get_running_loop().create_future()
        timer = asyncio.get_running_loop().call_later(
            SEND_TIMEOUT_S, self._timeout, ref)
        self._pending[ref] = future
        try:
            if not self.connection.send({
                "type": "send", "ref": ref, "agentId": agent_id, "convId": conv_id, "content": content,
            }):
                self._pending.pop(ref, None)
                return False
            return await future
        finally:
            timer.cancel()

    def _timeout(self, ref: str) -> None:
        future = self._pending.pop(ref, None)
        if future is not None and not future.done():
            future.set_result(False)

    async def _deliver(self, frame: InboundFrame) -> None:
        message = frame.message
        assert message is not None
        key = next((row["key"] for row in self.bot_agents if row.get("id") == frame.agent_id), None)
        if key is None:
            self._log("一条发给未登记 Bot 的消息被忽略")
            return
        delivered = self._cursor(frame.agent_id or "", frame.conv_id or "")
        if delivered is not None and message.seq <= delivered:
            return
        input = compose_input(frame)
        if input is None:
            # The cloud accepts this content type but the harness cannot show it.
            # Acknowledge so the server stops replaying, and say so in the
            # conversation instead of dropping it silently.
            self._ack(frame.agent_id or "", frame.conv_id or "", message.seq)
            try:
                await self.send(frame.agent_id or "", frame.conv_id or "", {
                    "type": "text",
                    "text": "这条消息的内容类型（卡片、图片或文件）暂不支持在 Hermes 中显示。",
                })
            except Exception:
                pass
            return
        try:
            session_id = await self._session_for_key(key)
            await self.harness.submit(session_id, input)
        except Exception as error:
            # No ack: the server keeps the cursor where it was, so the message is
            # redelivered on reconnect.
            self._log(f"消息投递失败：{error}")
            return
        self._replies[session_id] = {
            "agent_id": frame.agent_id, "conv_id": frame.conv_id, "parts": [],
        }
        self._ack(frame.agent_id or "", frame.conv_id or "", message.seq)

    def _ack(self, agent_id: str, conv_id: str, seq: int) -> None:
        self._on_ack(agent_id, conv_id, seq)
        self.connection.send({"type": "ack", "agentId": agent_id, "convId": conv_id, "seq": seq})

    async def on_session_event(self, event: SessionEvent) -> None:
        """Hermes runs live in this process: observe the reply and return it to
        the cloud conversation."""
        reply = self._replies.get(event.session_id)
        if reply is None:
            return
        if event.type == "message.complete":
            text = ""
            payload = event.payload if isinstance(event.payload, dict) else {}
            if isinstance(payload.get("text"), str):
                text = payload["text"]
            if text.strip():
                reply["parts"].append(text)
            return
        if event.type != "session.info":
            return
        payload = event.payload if isinstance(event.payload, dict) else {}
        if payload.get("running") is not False:
            return
        self._replies.pop(event.session_id, None)
        text = "\n".join(reply["parts"]).strip()
        if not text:
            return
        try:
            sent = await self.send(reply["agent_id"], reply["conv_id"], {"type": "markdown", "text": text})
        except Exception:
            sent = False
        if not sent:
            self._log("一条 Bot 回复未被云端确认，未自动重发")

    async def _session_for_key(self, key: str) -> str:
        recorded = self._session_for(key)
        if recorded and await self.harness.exists(recorded):
            return recorded
        if recorded:
            self._unbind_session(key)
        created = await self.harness.create({"title": f"Yonder · {key}"})
        session_id = created["sessionId"] if isinstance(created, dict) else created
        self._bind_session(key, session_id)
        return session_id

    def stop(self) -> None:
        self._stopped = True
        if self._sync_task is not None:
            self._sync_task.cancel()
            self._sync_task = None
        for future in self._pending.values():
            if not future.done():
                future.set_result(False)
        self._pending.clear()
        self._replies.clear()


def compose_input(frame: InboundFrame) -> Optional[str]:
    """The input handed to the harness for one cloud message. A replayed message
    keeps the 「补收」 marker so an old instruction is never taken for the current
    one (spec 16 §3). None for content the harness cannot carry."""
    message = frame.message
    assert message is not None
    content = message.content
    if content.get("type") not in ("text", "markdown"):
        return None
    text = content.get("text") if isinstance(content.get("text"), str) else ""
    if not text.strip():
        return None
    if frame.replayed:
        from datetime import datetime, timezone

        at = datetime.fromtimestamp(message.created_at / 1000, tz=timezone.utc).isoformat()
        return (f"[补收：这条消息发于 {at}，设备离线期间未送达。若其中的操作已被之后的消息取代，"
                f"不要再执行，先向对方确认。]\n{text}")
    sender = message.sender_name or "对方"
    place = "群聊" if frame.conv_kind == "group" else "私聊"
    return f"[Yonder {place} · {sender}]\n{text}"
