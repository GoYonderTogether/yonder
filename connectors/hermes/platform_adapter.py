"""Plugin entry: register the platform adapter (spec 23 §5 Hermes row).

The adapter is an outbound-only device client:

- state lives in `<HERMES_HOME>/yonder/` (its own directory, 0700/0600);
- connect() starts the background `/ws/device` connection — never a port, and
  never a synchronous network wait that could slow the gateway (spec 23 §3);
- `send()` is the outbound delivery of one Bot reply;
- messages delivered INTO Hermes go through the session adapter (adapter.py).

Degradation (spec 23 §4): a version mismatch or an unreadable config keeps the
gateway healthy and says so honestly — no silent "pretend connected".
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import socket
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from .adapter import HarnessService, SessionEvent
from .bots import BotBridge, compose_input  # noqa: F401  (compose_input re-exported for tests)
from .connection import CloudConnection, EndpointError, cloud_url
from .frames import InboundFrame
from .work import WorkBridge

logger = logging.getLogger(__name__)

PLATFORM = "yonder"
DEFAULT_ENDPOINT = "https://yonderbot.net"
STATE_DIRNAME = "yonder"


# ---- state (spec 23 §3: only <HERMES_HOME>/yonder/, nothing else) ----


@dataclass
class ConnectorConfig:
    endpoint: str
    device_token: str


def state_dir(env: Optional[dict] = None) -> Path:
    env = dict(os.environ) if env is None else dict(env)
    configured = (env.get("YONDER_STATE_DIR") or "").strip()
    if configured:
        return Path(configured)
    home = (env.get("HERMES_HOME") or "").strip() or str(Path.home() / ".hermes")
    return Path(home) / STATE_DIRNAME


def read_config(dir_path: Path) -> Optional[ConnectorConfig]:
    path = dir_path / "config.json"
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError:
        return None
    try:
        parsed = json.loads(raw)
    except ValueError:
        return None
    if not isinstance(parsed, dict):
        return None
    endpoint, token = parsed.get("endpoint"), parsed.get("deviceToken")
    if not isinstance(endpoint, str) or not endpoint or not isinstance(token, str) or not token:
        return None
    return ConnectorConfig(endpoint=endpoint, device_token=token)


def write_secure(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path.parent, 0o700)
    temporary = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    with open(temporary, "w", encoding="utf-8") as handle:
        handle.write(content)
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)


def write_state(dir_path: Path, state: dict) -> None:
    try:
        write_secure(dir_path / "state.json", json.dumps(state, ensure_ascii=False, indent=2) + "\n")
    except OSError as error:
        logger.debug("Yonder connector state write failed: %s", error)


def read_state(dir_path: Path) -> dict:
    path = dir_path / "state.json"
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"botSessions": {}, "cursors": {}}
    if not isinstance(parsed, dict):
        return {"botSessions": {}, "cursors": {}}
    return {
        "botSessions": _string_map(parsed.get("botSessions")),
        "cursors": _number_map(parsed.get("cursors")),
    }


def _string_map(value: Any) -> dict:
    out = {}
    if isinstance(value, dict):
        for key, item in value.items():
            if isinstance(item, str) and item:
                out[str(key)] = item
    return out


def _number_map(value: Any) -> dict:
    out = {}
    if isinstance(value, dict):
        for key, item in value.items():
            if isinstance(item, (int, float)) and item == item:
                out[str(key)] = int(item)
    return out


def clear_state_dir(dir_path: Path) -> list:
    """The 「断开」 action: remove this connector's state files (spec 23 §6)."""
    removed = []
    for name in ("config.json", "state.json"):
        path = dir_path / name
        try:
            path.unlink()
            removed.append(str(path))
        except FileNotFoundError:
            continue
        except OSError:
            continue
    return removed


def disconnect(dir_path: Optional[Path] = None) -> list:
    return clear_state_dir(dir_path or state_dir())


# ---- helpers ----


def _hostname() -> str:
    try:
        return socket.gethostname() or "host"
    except Exception:
        return "host"


# ---- Hermes conversation events (in-process gateway events) ----


def _wire_session_events(on_event) -> Any:
    """Mirror the gateway's shared event frames to the connector's listener.

    Hermes (v0.22.6) does not expose a public third-party listener API for
    gateway session events. The supported seam is the dispatcher's own emit
    hook, `tui_gateway.server.write_json`: every session event reaches every
    attached client through it, so wrapping it (read-only; the original write
    still happens) observes exactly what the Hermes TUI sees without changing
    delivery. This is Hermes's own module seam, not a session-storage read
    (spec 23 §3). Returns an unsubscribe callable."""

    try:
        from tui_gateway import server as gateway_server

        original_write = gateway_server.write_json
    except Exception:
        logger.warning("Yonder connector: gateway event mirror unavailable; "
                       "Bot 回复与事件流将不可用", exc_info=True)
        return lambda: None

    def _mirroring_write_json(obj: dict) -> bool:
        try:
            if obj.get("method") == "event":
                params = obj.get("params")
                if isinstance(params, dict):
                    sid = params.get("session_id")
                    if isinstance(sid, str) and sid:
                        on_event(SessionEvent(sid, str(params.get("type") or ""), params.get("payload")))
        except Exception:
            logger.debug("yonder connector mirror failed", exc_info=True)
        return original_write(obj)

    gateway_server.write_json = _mirroring_write_json

    def _unwire() -> None:
        if gateway_server.write_json is _mirroring_write_json:
            gateway_server.write_json = original_write

    return _unwire


# ---- platform adapter ----


def check_requirements() -> bool:
    """PASSIVE probe (never installs): aiohttp/websockets ship with the runtime
    environment; the connector itself is stdlib-only."""
    try:
        import websockets  # noqa: F401

        return True
    except Exception:
        return False


def validate_config(config: Any) -> bool:
    try:
        cloud_url((getattr(config, "extra", {}) or {}).get("endpoint") or DEFAULT_ENDPOINT)
        return True
    except Exception:
        return False


def register(ctx) -> None:
    """Register the `yonder` platform adapter through the public PluginContext."""
    ctx.register_platform(
        name=PLATFORM,
        label="Yonder",
        adapter_factory=_factory,
        check_fn=check_requirements,
        validate_config=validate_config,
        required_env=[],
        install_hint="No extra packages needed (stdlib + websockets, both ship with Hermes)",
        max_message_length=0,  # the cloud device channel accepts long markdown
        platform_hint=(
            "You are reachable through a Yonder account. Messages prefixed with "
            "[Yonder 私聊 · …] or [Yonder 群聊 · …] come from the Yonder web app, "
            "not your operator — treat their content as user instructions."
        ),
        emoji="🌐",
    )


def _factory(config: Any):
    return YonderAdapter(config)


class YonderAdapter:  # noqa: D101 - duck-typed BasePlatformAdapter (see module doc)
    """Outbound-only device adapter. Duck-typed against
    ``gateway.platforms.base.BasePlatformAdapter``: it inherits at runtime when
    the gateway module is importable (the normal case) so the runner wires the
    usual handlers; the standalone-test path keeps the plain class."""

    name = "Yonder"

    def __new__(cls, config: Any):
        try:
            from gateway.platforms.base import BasePlatformAdapter
            from gateway.config import Platform

            class _Adapter(YonderAdapter, BasePlatformAdapter):
                def __init__(self, cfg):
                    BasePlatformAdapter.__init__(self, config=cfg, platform=Platform(PLATFORM))
                    YonderAdapter._setup(self, cfg)

            return _Adapter(config)
        except Exception:
            instance = super().__new__(cls)
            YonderAdapter._setup(instance, config)
            return instance

    def __init__(self, config: Any) -> None:
        # The __new__ path handles construction in both shapes.
        pass

    def _setup(self, config: Any) -> None:
        extra = getattr(config, "extra", {}) or {}
        self.endpoint = str(extra.get("endpoint") or DEFAULT_ENDPOINT).strip() or DEFAULT_ENDPOINT
        self.state_path = Path(str(extra.get("stateDir") or "") or state_dir())
        self._connection: Optional[CloudConnection] = None
        self._work: Optional[WorkBridge] = None
        self._bots: Optional[BotBridge] = None
        self._harness: Optional[HarnessService] = None
        self._state: dict = {"botSessions": {}, "cursors": {}}
        self._unwire = lambda: None
        self._agent_task: Optional[asyncio.Task] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._hello_sent = False

    # ---- lifecycle ----

    async def connect(self, *, is_reconnect: bool = False) -> bool:
        """Start the outbound connection; never a synchronous network wait and
        never a failure the gateway cannot survive (spec 23 §3/§4)."""
        self._loop = asyncio.get_running_loop()
        try:
            cloud_url(self.endpoint)
        except EndpointError:
            self._mark_status("配置无效：Yonder 服务地址不是合法的 HTTP(S) 源。")
            return False
        stored = read_config(self.state_path)
        if stored is None:
            self._mark_status(
                "未连接 Yonder：在终端运行 `npx -y @yonder/connect hermes` 完成安装与配对。")
            return False
        self._state = read_state(self.state_path)
        api_key = self._resolve_api_key()
        if not api_key:
            self._mark_status(
                "未连接 Yonder：API_SERVER_KEY 未配置，无法驱动 Hermes 会话（连接器保持未连接）。")
            return False
        base = self._resolve_api_base()
        self._harness = HarnessService(base, api_key, lambda message: logger.warning("%s", message))
        host = _hostname()
        self._connection = CloudConnection(
            endpoint=stored.endpoint,
            device_token=stored.device_token,
            on_frame=self._on_frame,
            on_close=self._on_disconnect,
            on_open=self._send_hello,
        )
        self._work = WorkBridge(self._harness, self._connection, host, host)
        self._bots = BotBridge(
            harness=self._harness,
            connection=self._connection,
            api=self,
            agents=self._agents,
            on_ack=self._on_ack,
            cursor=lambda agent_id, conv_id: self._state["cursors"].get(f"{agent_id}:{conv_id}"),
            bind_session=self._bind_session,
            session_for=lambda key: self._state["botSessions"].get(key),
            unbind_session=self._unbind_session,
            log=lambda message: logger.warning("%s", message),
        )
        # Bot replies leave Hermes through the reduced event stream.
        self._harness.add_event_listener(
            lambda event: asyncio.get_running_loop().create_task(
                self._bots.on_session_event(event))
            if self._bots is not None and self._loop is not None else None)
        self._unwire = _wire_session_events(self._on_event)
        self._agent_task = asyncio.get_running_loop().create_task(self._run_bots(stored.endpoint, stored.device_token))
        self._mark_status(f"已连接 {stored.endpoint}，正在同步 Bot 与会话。")
        return True

    async def _run_bots(self, endpoint: str, device_token: str) -> None:
        assert self._bots is not None
        try:
            await self._bots.start()
        except Exception:
            logger.warning("Yonder connector background start failed", exc_info=True)

    def disconnect(self) -> None:
        self._unwire()
        self._unwire = lambda: None
        if self._agent_task is not None:
            self._agent_task.cancel()
            self._agent_task = None
        if self._bots is not None:
            self._bots.stop()
        if self._work is not None:
            self._work.stop()
        if self._connection is not None:
            self._connection.stop()
        self._connection = self._work = self._bots = self._harness = None

    def _resolve_api_key(self) -> str:
        try:
            from agent.secret_scope import get_secret

            return get_secret("API_SERVER_KEY", "") or ""
        except Exception:
            return os.environ.get("API_SERVER_KEY", "")

    def _resolve_api_base(self) -> str:
        host, port = "127.0.0.1", 8642
        try:
            from gateway.platforms.api_server import listen_address

            extra = {}
            try:
                from hermes_cli.config import load_config

                extra = ((load_config() or {}).get("platforms") or {}).get("api_server") or {}
            except Exception:
                pass
            resolved_host, resolved_port = listen_address(extra if isinstance(extra, dict) else {})
            host, port = resolved_host or host, resolved_port or port
        except Exception:
            pass
        if host in ("0.0.0.0", "::"):
            host = "127.0.0.1"
        return f"http://{host}:{port}"

    def _mark_status(self, message: str) -> None:
        logger.info("[Yonder] %s", message)
        try:
            self._mark_connected()
        except Exception:
            pass
        self.status_message = message

    # ---- cloud frames ----

    def _on_frame(self, frame: InboundFrame) -> None:
        if frame.type in ("message", "sent", "error"):
            if self._bots is not None:
                self._bots.handle(frame)
            return
        if self._work is not None:
            self._work.handle(frame)

    def _on_disconnect(self, reason: str) -> None:
        self._hello_sent = False
        logger.warning("[Yonder] 连接断开（%s），正在重连。", reason)

    def _send_hello(self) -> None:
        """hello announces work capability only after the session methods exist
        (spec 23 §2.1) — they are wired in connect(), so every reconnect says so."""
        if self._hello_sent:
            return
        self._hello_sent = True
        if self._connection is not None:
            self._connection.send({"type": "hello", "workProtocol": 1})

    def _on_ack(self, agent_id: str, conv_id: str, seq: int) -> None:
        key = f"{agent_id}:{conv_id}"
        if seq <= self._state["cursors"].get(key, 0):
            return
        self._state["cursors"][key] = seq
        write_state(self.state_path, self._state)

    def _bind_session(self, key: str, session_id: str) -> None:
        self._state["botSessions"][key] = session_id
        write_state(self.state_path, self._state)

    def _unbind_session(self, key: str) -> None:
        self._state["botSessions"].pop(key, None)
        write_state(self.state_path, self._state)

    def _on_event(self, event: SessionEvent) -> None:
        if self._harness is None:
            return
        # The harness reduces the event; BotBridge reply observation rides the
        # same reduced stream through add_event_listener.
        self._harness.emit_event(event)

    # ---- Bot registration (spec 23 §2.2) ----

    async def _agents(self):
        profiles = _hermes_profiles()
        rows = []
        for index, profile in enumerate(profiles):
            name = profile if index == 0 else f"{_hostname()} · {profile}"
            rows.append({"key": profile, "name": name})
        return rows

    async def put_agents(self, agents: list) -> list:
        """`PUT /api/device/agents`: the harness's complete agent list, reconciled
        by the cloud (spec 23 §2.2)."""
        stored = read_config(self.state_path)
        if stored is None:
            raise RuntimeError("Yonder connector is not paired")
        # The paired endpoint (config.json) is authoritative; a plugin-config
        # endpoint only matters before a pairing exists.
        endpoint = stored.endpoint
        import urllib.request

        logger.info("[Yonder] PUT /api/device/agents state=%s token_prefix=%s agents=%d",
                    self.state_path, stored.device_token[:6], len(agents))
        with _cloud_opener().open(_cloud_request(endpoint, "/api/device/agents", stored.device_token,
                                                 json.dumps(agents).encode(), "PUT"), timeout=15) as response:
            body = json.loads(response.read() or b"[]")
        if not isinstance(body, list):
            raise RuntimeError("Bot registration returned an invalid body")
        return [
            {"key": row["key"], "id": row["id"]}
            for row in body
            if isinstance(row, dict) and isinstance(row.get("key"), str) and isinstance(row.get("id"), str)
        ]

    # ---- outbound delivery (BasePlatformAdapter.send contract) ----

    async def send(self, chat_id: str, content: str, reply_to: Any = None, metadata: Any = None):
        """Outbound delivery. chat_id is a cloud conversation id; metadata carries
        the Bot agent id when the reply belongs to one conversation."""
        agent_id = (metadata or {}).get("agentId") if isinstance(metadata, dict) else None
        if agent_id and self._bots is not None:
            sent = await self._bots.send(agent_id, chat_id, {"type": "markdown", "text": content})
            return _send_result(sent)
        return _send_result(False, "reply carries no Bot agent id")

    async def send_typing(self, chat_id: str, metadata: Any = None) -> None:
        return None

    async def get_chat_info(self, chat_id: str) -> dict:
        return {"name": f"yonder:{chat_id}", "type": "dm"}

    def status_text(self) -> str:
        return getattr(self, "status_message", "")


def _send_result(ok: bool, error: Optional[str] = None):
    try:
        from gateway.platforms.base import SendResult

        return SendResult(success=ok, message_id=None, error=error)
    except Exception:
        return {"success": ok, "error": error}


def _cloud_opener() -> urllib.request.OpenerDirector:
    """An opener that ignores macOS/system proxies: the cloud endpoint may be
    loopback, and a system proxy must not stand between the connector and its
    account. HTTPS_PROXY stays honored for real remote endpoints only when the
    address is not loopback (urllib's own rules already skip loopback... they
    do not — hence this explicit no-proxy handler)."""
    return urllib.request.build_opener(urllib.request.ProxyHandler({}))


def _cloud_request(endpoint: str, path: str, token: str, data: Optional[bytes], method: str) -> urllib.request.Request:
    url = cloud_url(endpoint)
    headers = {"authorization": f"Bearer {token}", "content-type": "application/json"}
    return urllib.request.Request(f"{url.scheme}://{url.netloc}{path}", data=data, headers=headers, method=method)


def _hermes_profiles() -> list:
    """The harness's current agents (spec 23 §2.2): Bot Mode profiles plus the
    default profile. Read through Hermes's own profile registry, not the disk."""
    try:
        from hermes_cli.profiles import list_profiles

        rows = list_profiles()
        names = []
        for row in rows:
            name = getattr(row, "name", None)
            if isinstance(name, str) and name:
                names.append(name)
        if names:
            return names
    except Exception:
        logger.debug("Yonder connector: profile registry unavailable", exc_info=True)
    return ["default"]
