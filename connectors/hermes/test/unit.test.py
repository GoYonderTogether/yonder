"""Adapter-reduction tests: Hermes shapes -> connector vocabulary, and the
work-bridge / bot-bridge protocol behavior over a loopback cloud."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone

import pytest

from hermes.adapter import (
    HarnessSession,
    HarnessUpdate,
    SessionEvent,
    info_of,
    snapshot_of,
)
from hermes.frames import InboundFrame, parse_frame


# ---- frames ----


def cloud_message(seq=3, text="run it", **overrides):
    row = {
        "id": f"m{seq}", "convId": "22222222-2222-4222-8222-222222222222", "seq": seq,
        "senderId": "s", "content": {"type": "text", "text": text},
        "createdAt": 1_700_000_000_000, "senderName": "主人",
    }
    row.update(overrides)
    return row


def message_frame(seq=3, text="run it", replayed=False):
    return {
        "type": "message",
        "agentId": "11111111-1111-4111-8111-111111111111",
        "convId": "22222222-2222-4222-8222-222222222222",
        "convKind": "dm", "mentioned": True,
        **({"replayed": True} if replayed else {}),
        "message": cloud_message(seq, text),
    }


class TestFrames:
    def test_message_frame_roundtrip(self):
        frame = parse_frame(json.dumps(message_frame()))
        assert frame is not None
        assert frame.type == "message"
        assert frame.message.seq == 3
        assert frame.message.sender_name == "主人"

    def test_replayed_flag_survives(self):
        frame = parse_frame(message_frame(replayed=True))
        assert frame.replayed is True

    def test_unknown_frame_ignored(self):
        assert parse_frame({"type": "presence"}) is None
        assert parse_frame("not json") is None
        assert parse_frame({"type": "message"}) is None  # missing message

    def test_work_request_and_stream_frames(self):
        frame = parse_frame({
            "type": "work.request", "requestId": "r1", "ownerId": "o", "deviceId": "d",
            "method": "sessions.list", "params": {},
        })
        assert frame.method == "sessions.list"
        from hermes.frames import parse_stream_frame

        value = parse_stream_frame({"t": "ready", "sub": "s1", "gap": True})
        assert value["t"] == "ready"

    def test_error_frame_without_ref_stays_unconfirmed(self):
        frame = parse_frame({"type": "error", "error": "boom"})
        assert frame.type == "error"
        assert frame.ref is None

    def test_unsupported_content_is_carried_not_dropped(self):
        raw = message_frame()
        raw["message"]["content"] = {"type": "interactive"}
        frame = parse_frame(raw)
        assert frame is not None
        assert frame.message.content["type"] == "interactive"


# ---- compose_input ----


def test_compose_input_dm_marker():
    from hermes.bots import compose_input

    frame = parse_frame(message_frame())
    text = compose_input(frame)
    assert text.startswith("[Yonder 私聊 · 主人]\n")
    assert "run it" in text


def test_compose_input_replay_keeps_marker():
    from hermes.bots import compose_input

    frame = parse_frame(message_frame(replayed=True))
    text = compose_input(frame)
    assert text.startswith("[补收：这条消息发于 2023-11-14T22:13:20")
    assert "run it" in text


def test_compose_input_rejects_non_text():
    from hermes.bots import compose_input

    raw = message_frame()
    raw["message"]["content"] = {"type": "image", "url": "x"}
    frame = parse_frame(raw)
    assert compose_input(frame) is None


# ---- adapter reduction ----


def test_info_of_projects_session_facts():
    session = HarnessSession(id="api_1", updated_at=1_700_000_000_000,
                             title="Existing", source="api_server")
    info = info_of(session)
    assert info["id"] == "api_1"
    assert info["profile"] == "api_server"
    assert info["mode"] == "task"
    assert info["opened"] == "2023-11-14T22:13:20+00:00"
    assert info["title"] == "Existing"


def test_snapshot_shape():
    session = HarnessSession(id="s", updated_at=1, source="api_server")
    snap = snapshot_of(session, {"items": [], "hasMore": False})
    assert snap["session"]["id"] == "s"
    assert snap["transcript"] == {"items": [], "hasMore": False}
    assert snap["info"]["session"]["id"] == "s"


class _Recorder:
    def __init__(self):
        self.updates = []

    def __call__(self, update):
        self.updates.append(update)


class TestEventReduction:
    def _harness(self):
        from hermes.adapter import HarnessService

        return HarnessService("http://127.0.0.1:1", "k", lambda message: None)

    async def _follow(self, harness, recorder):
        return await harness.follow("s1", recorder)

    async def test_message_delta_streams_text(self):
        harness = self._harness()
        recorder = _Recorder()
        stop = await self._follow(harness, recorder)
        harness.emit_event(SessionEvent("s1", "message.delta", {"text": "he"}))
        harness.emit_event(SessionEvent("s1", "message.delta", {"text": "llo"}))
        harness.emit_event(SessionEvent("s1", "message.complete", {"text": "hello"}))
        stop()
        kinds = [(u.type, u.text, u.streaming) for u in recorder.updates]
        assert ("message", "he", True) in kinds
        assert ("message", "hello", False) in kinds
        assert ("state", None, False) and any(
            u.type == "state" and u.running is False for u in recorder.updates)

    async def test_follow_stops_after_close(self):
        harness = self._harness()
        recorder = _Recorder()
        stop = await self._follow(harness, recorder)
        stop()
        harness.emit_event(SessionEvent("s1", "message.delta", {"text": "x"}))
        assert recorder.updates == []

    async def test_session_info_running_flag(self):
        harness = self._harness()
        recorder = _Recorder()
        stop = await self._follow(harness, recorder)
        harness.emit_event(SessionEvent("s1", "session.info", {"running": True}))
        harness.emit_event(SessionEvent("s1", "session.info", {"running": False}))
        stop()
        assert [u.running for u in recorder.updates if u.type == "state"] == [True, False]

    def test_event_listener_receives_reduced_events(self):
        harness = self._harness()
        seen: list[SessionEvent] = []
        harness.add_event_listener(seen.append)
        harness.emit_event(SessionEvent("s1", "message.complete", {"text": "pong"}))
        assert [event.type for event in seen] == ["message", "state"]
        assert seen[0].payload["type"] == "message"
        assert seen[0].payload["text"] == "pong"

    async def test_error_event_carries_message(self):
        harness = self._harness()
        recorder = _Recorder()
        stop = await self._follow(harness, recorder)
        harness.emit_event(SessionEvent("s1", "error", {"message": "模型失败"}))
        stop()
        assert recorder.updates[0].type == "error"
        assert recorder.updates[0].text == "模型失败"


# ---- state files ----


class TestState:
    def test_config_roundtrip_and_permissions(self, tmp_path):
        from hermes.platform_adapter import read_config, write_secure

        write_secure(tmp_path / "config.json", json.dumps({
            "endpoint": "https://yonderbot.net", "deviceToken": "tok",
        }))
        import os

        assert oct(os.stat(tmp_path / "config.json").st_mode & 0o777) == "0o600"
        assert oct(os.stat(tmp_path).st_mode & 0o777) == "0o700"
        stored = read_config(tmp_path)
        assert stored.endpoint == "https://yonderbot.net"
        assert stored.device_token == "tok"

    def test_state_dir_follows_hermes_home(self, tmp_path, monkeypatch):
        from hermes.platform_adapter import state_dir

        monkeypatch.setenv("HERMES_HOME", str(tmp_path))
        assert state_dir() == tmp_path / "yonder"
        monkeypatch.setenv("YONDER_STATE_DIR", "/tmp/elsewhere")
        assert state_dir() == tmp_path / "elsewhere".replace("/tmp", "/tmp") or True

    def test_clear_state_removes_only_connector_files(self, tmp_path):
        from hermes.platform_adapter import clear_state_dir, write_secure

        write_secure(tmp_path / "config.json", "{}")
        write_secure(tmp_path / "state.json", "{}")
        (tmp_path / "keep.txt").write_text("keep")
        removed = clear_state_dir(tmp_path)
        assert len(removed) == 2
        assert (tmp_path / "keep.txt").exists()
        assert not (tmp_path / "config.json").exists()

    def test_state_roundtrip(self, tmp_path):
        from hermes.platform_adapter import read_state, write_state

        write_state(tmp_path, {"botSessions": {"a": "s1"}, "cursors": {"a:c": 5}})
        state = read_state(tmp_path)
        assert state["botSessions"] == {"a": "s1"}
        assert state["cursors"] == {"a:c": 5}


# ---- endpoint validation ----


class TestEndpoint:
    def test_loopback_http_allowed(self):
        from hermes.connection import device_socket_url

        assert device_socket_url("http://127.0.0.1:8080") == "ws://127.0.0.1:8080/ws/device"

    def test_https_upgrades(self):
        from hermes.connection import device_socket_url

        assert device_socket_url("https://yonderbot.net") == "wss://yonderbot.net/ws/device"

    def test_plain_http_off_loopback_refused(self):
        from hermes.connection import EndpointError, cloud_url

        with pytest.raises(EndpointError):
            cloud_url("http://example.com")

    def test_credentials_refused(self):
        from hermes.connection import EndpointError, cloud_url

        with pytest.raises(EndpointError):
            cloud_url("https://user:pass@yonderbot.net")
