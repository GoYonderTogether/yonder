"""Protocol tests: the connector's side of `/ws/device` over a real loopback
WebSocket, with a harness double. A transport double, never a model double."""

from __future__ import annotations

import asyncio
import json
import uuid

import pytest
from websockets.asyncio.server import serve as ws_serve

from hermes.adapter import HarnessSession, HarnessUpdate
from hermes.bots import BotBridge
from hermes.connection import CloudConnection
from hermes.frames import parse_frame
from hermes.work import WorkBridge

AGENT_ID = "11111111-1111-4111-8111-111111111111"
CONV_ID = "22222222-2222-4222-8222-222222222222"


class FakeCloud:
    """Loopback double for the cloud's side of /ws/device."""

    def __init__(self):
        self.frames: list = []
        self.paths: list = []
        self.auth: list = []
        self.sockets = 0
        self._server = None
        self._clients = set()
        self._incoming: asyncio.Queue = asyncio.Queue()

    async def start(self):
        async def handler(ws):
            self.sockets += 1
            self.auth.append(ws.request.headers.get("authorization", ""))
            self.paths.append(ws.request.path)
            self._clients.add(ws)
            try:
                async for raw in ws:
                    self.frames.append(json.loads(raw))
            except Exception:
                pass
            finally:
                self._clients.discard(ws)
                self.sockets -= 1

        self._server = await ws_serve(handler, "127.0.0.1", 0)
        port = self._server.sockets[0].getsockname()[1]
        return f"http://127.0.0.1:{port}"

    async def push(self, value):
        for ws in list(self._clients):
            await ws.send(json.dumps(value))

    async def wait_for(self, check, label, timeout=5.0):
        async def _poll():
            deadline = asyncio.get_running_loop().time() + timeout
            while asyncio.get_running_loop().time() < deadline:
                if check():
                    return
                await asyncio.sleep(0.02)
            raise AssertionError(f"timed out: {label}")

        await _poll()

    async def stop(self):
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()
        for ws in list(self._clients):
            await ws.close()


class HarnessDouble:
    """A harness double used only to observe calls; it runs no model and
    writes no session."""

    def __init__(self):
        self.calls: list[tuple] = []
        self.updates: list = []
        self.emit: asyncio.Queue = asyncio.Queue()
        self.sessions: dict[str, dict] = {
            "api_1": {"id": "api_1", "title": "Existing", "source": "api_server", "updated": 1.0},
        }
        self.created = 0
        self.fail_submit = False

    async def list(self):
        self.calls.append(("list",))
        return [HarnessSession(id=s["id"], updated_at=s["updated"], title=s["title"],
                               source=s["source"]) for s in self.sessions.values()]

    async def show(self, session_id):
        self.calls.append(("show", session_id))
        row = self.sessions.get(session_id)
        if row is None:
            return None
        return HarnessSession(id=row["id"], updated_at=row["updated"], title=row["title"],
                              source=row["source"])

    async def exists(self, session_id):
        return await self.show(session_id) is not None

    async def transcript(self, session_id, limit, before=None):
        self.calls.append(("transcript", session_id, limit, before))
        return {"items": [{"id": 1, "kind": "yonder.message", "text": "hi"}], "hasMore": False}

    async def create(self, options=None):
        self.calls.append(("create", options))
        self.created += 1
        sid = f"api_new_{self.created}"
        self.sessions[sid] = {"id": sid, "title": None, "source": "api_server", "updated": 2.0}
        return {"sessionId": sid}

    async def submit(self, session_id, text):
        self.calls.append(("submit", session_id, text))
        if self.fail_submit:
            raise RuntimeError("harness refused")
        await self.emit.put(session_id)

    async def abort(self, session_id):
        self.calls.append(("abort", session_id))

    async def follow(self, session_id, on_update):
        self.calls.append(("follow", session_id))
        self.updates.append(on_update)
        self._live = on_update
        self._live_session = session_id
        return lambda: None

    def push_update(self, update: HarnessUpdate):
        if getattr(self, "_live", None) is not None:
            self._live(update)


async def rig(agents=None, put_agents=None, harness=None):
    cloud = FakeCloud()
    endpoint = await cloud.start()
    harness = harness or HarnessDouble()
    state = {"cursors": {}, "botSessions": {}}
    parsed_frames: list = []

    async def put(list):
        if put_agents is not None:
            return await put_agents(list)
        return [{"key": row["key"], "id": AGENT_ID} for row in list]

    def on_frame(frame):
        parsed_frames.append(frame)
        if not bots.handle(frame):
            work.handle(frame)

    connection = CloudConnection(endpoint=endpoint, device_token="token-abc", on_frame=on_frame)
    work = WorkBridge(harness, connection, "host", "host")

    async def _agents_fn():
        return [{"key": "default", "name": "host"}] if agents is None else agents

    bots = BotBridge(
        harness=harness,
        connection=connection,
        api=type("Api", (), {"put_agents": staticmethod(put)})(),
        agents=_agents_fn,
        on_ack=lambda agent_id, conv_id, seq: state["cursors"].__setitem__(
            f"{agent_id}:{conv_id}", seq),
        cursor=lambda agent_id, conv_id: state["cursors"].get(f"{agent_id}:{conv_id}"),
        bind_session=lambda key, sid: state["botSessions"].__setitem__(key, sid),
        session_for=lambda key: state["botSessions"].get(key),
        unbind_session=lambda key: state["botSessions"].pop(key, None),
        log=lambda message: None,
    )
    started = asyncio.ensure_future(bots.start())
    await cloud.wait_for(lambda: cloud.sockets >= 1, "socket")
    return cloud, connection, work, bots, harness, state, started


async def wait_for(check, label, timeout=5.0):
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        if check():
            return
        await asyncio.sleep(0.02)
    raise AssertionError(f"timed out: {label}")


@pytest.mark.asyncio
class TestConnection:
    async def test_connects_outbound_with_token(self):
        cloud, connection, *_ = await rig()
        try:
            assert cloud.paths[-1] == "/ws/device"
            assert cloud.auth[-1] == "Bearer token-abc"
            assert connection.send({"type": "hello", "workProtocol": 1}) is True
            await cloud.wait_for(lambda: cloud.frames, "hello")
            assert cloud.frames[0] == {"type": "hello", "workProtocol": 1}
        finally:
            connection.stop()
            await cloud.stop()

    async def test_bot_registration_is_full_list(self):
        puts: list = []

        async def put(rows):
            puts.append(rows)
            return [{"key": row["key"], "id": AGENT_ID} for row in rows]

        cloud, connection, *_ = await rig(
            agents=[{"key": "default", "name": "host"}, {"key": "coder", "name": "host · coder"}],
            put_agents=put)
        try:
            await wait_for(lambda: puts, "put")
            assert puts[0] == [
                {"key": "default", "name": "host", "avatarUrl": None},
                {"key": "coder", "name": "host · coder", "avatarUrl": None},
            ]
        finally:
            connection.stop()
            await cloud.stop()

    async def test_empty_agent_list_never_retires_every_bot(self):
        puts: list = []

        async def put(rows):
            puts.append(rows)
            return []

        cloud, connection, *_ = await rig(agents=[], put_agents=put)
        try:
            await asyncio.sleep(0.2)
            assert puts == []
        finally:
            connection.stop()
            await cloud.stop()


def message(seq=3, text="run it", replayed=False):
    row = {
        "id": f"m{seq}", "convId": CONV_ID, "seq": seq, "senderId": "s",
        "content": {"type": "text", "text": text}, "createdAt": 1_700_000_000_000,
        "senderName": "主人",
    }
    frame = {
        "type": "message", "agentId": AGENT_ID, "convId": CONV_ID, "convKind": "dm",
        "mentioned": True, "message": row,
    }
    if replayed:
        frame["replayed"] = True
    return frame


@pytest.mark.asyncio
class TestBots:
    async def test_delivers_message_into_new_session_and_acks(self):
        cloud, connection, work, bots, harness, state, started = await rig()
        try:
            await cloud.wait_for(lambda: bots.bot_agents, "agents")
            bots.handle(parse_frame(message()))
            await wait_for(lambda: any(c[0] == "submit" for c in harness.calls), "submit")
            submit = next(c for c in harness.calls if c[0] == "submit")
            assert submit[1] == "api_new_1"
            assert submit[2].startswith("[Yonder 私聊 · 主人]\n")
            await cloud.wait_for(lambda: any(f.get("type") == "ack" for f in cloud.frames), "ack")
            ack = next(f for f in cloud.frames if f["type"] == "ack")
            assert ack["seq"] == 3 and ack["agentId"] == AGENT_ID
            assert state["cursors"][f"{AGENT_ID}:{CONV_ID}"] == 3
        finally:
            bots.stop()
            connection.stop()
            await cloud.stop()

    async def test_replayed_message_keeps_the_marker(self):
        cloud, connection, work, bots, harness, *_ = await rig()
        try:
            await cloud.wait_for(lambda: bots.bot_agents, "agents")
            bots.handle(parse_frame(message(replayed=True)))
            await wait_for(lambda: any(c[0] == "submit" for c in harness.calls), "submit")
            submit = next(c for c in harness.calls if c[0] == "submit")
            assert "补收" in submit[2]
        finally:
            bots.stop()
            connection.stop()
            await cloud.stop()

    async def test_a_failed_delivery_is_not_acked(self):
        harness = HarnessDouble()
        harness.fail_submit = True
        cloud, connection, work, bots, harness, *_ = await rig(harness=harness)
        try:
            await cloud.wait_for(lambda: bots.bot_agents, "agents")
            bots.handle(parse_frame(message()))
            await wait_for(lambda: any(c[0] == "submit" for c in harness.calls), "submit")
            await asyncio.sleep(0.2)
            assert not any(f.get("type") == "ack" for f in cloud.frames)
        finally:
            bots.stop()
            connection.stop()
            await cloud.stop()

    async def test_duplicate_seq_not_delivered_twice(self):
        cloud, connection, work, bots, harness, state, *_ = await rig()
        try:
            await cloud.wait_for(lambda: bots.bot_agents, "agents")
            bots.handle(parse_frame(message()))
            await wait_for(lambda: state["cursors"].get(f"{AGENT_ID}:{CONV_ID}") == 3, "ack")
            bots.handle(parse_frame(message()))
            await asyncio.sleep(0.2)
            assert len([c for c in harness.calls if c[0] == "submit"]) == 1
        finally:
            bots.stop()
            connection.stop()
            await cloud.stop()

    async def test_reply_returns_to_cloud_after_session_event(self):
        cloud, connection, work, bots, harness, *_ = await rig()
        try:
            await cloud.wait_for(lambda: bots.bot_agents, "agents")
            bots.handle(parse_frame(message()))
            await wait_for(lambda: any(c[0] == "submit" for c in harness.calls), "submit")
            session_id = next(c[1] for c in harness.calls if c[0] == "submit")
            # One assistant turn completes in the harness.
            await bots.on_session_event(_Event(session_id, "message.complete", {"text": "pong"}))
            await bots.on_session_event(_Event(session_id, "session.info", {"running": False}))
            await cloud.wait_for(
                lambda: any(f.get("type") == "sent" or f.get("type") == "ack" for f in cloud.frames),
                "reply")
            send = next((f for f in cloud.frames if f["type"] == "send"), None)
            assert send is not None
            assert send["content"] == {"type": "markdown", "text": "pong"}
        finally:
            bots.stop()
            connection.stop()
            await cloud.stop()


class _Event:
    def __init__(self, session_id, type, payload=None):
        self.session_id = session_id
        self.type = type
        self.payload = payload


@pytest.mark.asyncio
class TestWorkBridge:
    async def _ready(self):
        cloud, connection, work, bots, harness, state, started = await rig()
        await cloud.wait_for(lambda: bots.bot_agents, "agents")
        return cloud, connection, work, bots, harness, state

    async def _rpc(self, cloud, method, params):
        request_id = str(uuid.uuid4())
        await cloud.push({"type": "work.request", "requestId": request_id, "ownerId": "o",
                          "deviceId": "d", "method": method, "params": params})
        await cloud.wait_for(
            lambda: any(f.get("type") == "work.response" and f.get("requestId") == request_id
                        for f in cloud.frames),
            f"response {method}")
        return next(f for f in cloud.frames
                    if f.get("type") == "work.response" and f.get("requestId") == request_id)

    async def test_sessions_list_and_transcript(self):
        cloud, connection, work, bots, harness, _ = await self._ready()
        try:
            result = await self._rpc(cloud, "sessions.list", {})
            assert result["ok"] is True
            assert result["result"][0]["id"] == "api_1"
            result = await self._rpc(cloud, "sessions.transcript", {"id": "api_1", "limit": 10})
            assert result["ok"] is True
            assert result["result"]["items"][0]["text"] == "hi"
        finally:
            work.stop()
            bots.stop()
            connection.stop()
            await cloud.stop()

    async def test_open_submit_abort_flow(self):
        cloud, connection, work, bots, harness, _ = await self._ready()
        try:
            result = await self._rpc(cloud, "sessions.open", {"title": "Fresh"})
            assert result["ok"] is True
            new_id = result["result"]["id"]
            result = await self._rpc(cloud, "sessions.submit", {"id": new_id, "text": "hi"})
            assert result["ok"] is True
            result = await self._rpc(cloud, "sessions.abort", {"id": new_id})
            assert result["ok"] is True
            assert any(c[0] == "abort" and c[1] == new_id for c in harness.calls)
        finally:
            work.stop()
            bots.stop()
            connection.stop()
            await cloud.stop()

    async def test_unsupported_method_answers_unsupported(self):
        cloud, connection, work, bots, harness, _ = await self._ready()
        try:
            result = await self._rpc(cloud, "sessions.fork", {"id": "api_1"})
            assert result["ok"] is False
            assert result["error"]["code"] == "unsupported"
        finally:
            work.stop()
            bots.stop()
            connection.stop()
            await cloud.stop()

    async def test_watch_stream_relays_updates(self):
        cloud, connection, work, bots, harness, _ = await self._ready()
        try:
            await cloud.push({"type": "work.open", "channelId": "c1", "ownerId": "o", "deviceId": "d"})
            await cloud.push({"type": "work.frame", "channelId": "c1", "ownerId": "o", "deviceId": "d",
                              "frame": {"t": "sub", "sub": "s1", "method": "sessions.watch",
                                        "params": {"id": "api_1"}}})
            await cloud.wait_for(
                lambda: any(isinstance(f.get("frame"), dict) and f["frame"].get("t") == "ready"
                            for f in cloud.frames),
                "ready")
            harness.push_update(HarnessUpdate(type="message", text="streamed", streaming=True))
            await cloud.wait_for(
                lambda: any(isinstance(f.get("frame"), dict) and f["frame"].get("t") == "ev"
                            for f in cloud.frames),
                "ev")
            event = next(f["frame"] for f in cloud.frames
                         if isinstance(f.get("frame"), dict) and f["frame"].get("t") == "ev")
            assert event["type"] == "session.update"
            assert event["data"]["text"] == "streamed"
        finally:
            work.stop()
            bots.stop()
            connection.stop()
            await cloud.stop()

    async def test_ping_pong(self):
        cloud, connection, work, bots, harness, _ = await self._ready()
        try:
            await cloud.push({"type": "work.open", "channelId": "c1", "ownerId": "o", "deviceId": "d"})
            await cloud.push({"type": "work.frame", "channelId": "c1", "ownerId": "o", "deviceId": "d",
                              "frame": {"t": "ping", "n": 7}})
            await cloud.wait_for(
                lambda: any(isinstance(f.get("frame"), dict) and f["frame"].get("t") == "pong"
                            for f in cloud.frames),
                "pong")
            pong = next(f["frame"] for f in cloud.frames
                        if isinstance(f.get("frame"), dict) and f["frame"].get("t") == "pong")
            assert pong["n"] == 7
        finally:
            work.stop()
            bots.stop()
            connection.stop()
            await cloud.stop()
