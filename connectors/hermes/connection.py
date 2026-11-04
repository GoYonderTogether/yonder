"""Outbound `/ws/device` connection with exponential backoff (spec 23 §2.1).

This never listens on a port, never blocks plugin startup, and never replays a
mutation: a lost socket only reconnects, and the server's `agent_cursor` replay
decides what is redelivered. Python twin of `connectors/dsh/src/connection.ts`.
"""

from __future__ import annotations

import asyncio
from typing import Any, Awaitable, Callable, Optional
from urllib.parse import urlsplit

from .frames import InboundFrame, parse_frame

FIRST_DELAY_S = 1.0
MAX_DELAY_S = 30.0
MAX_PAYLOAD = 1_400_000


class EndpointError(ValueError):
    pass


def cloud_url(endpoint: str) -> urlsplit:
    """Validate the endpoint the same way the Card channel does: an HTTP(S)
    origin without credentials, plain HTTP only on loopback."""
    try:
        url = urlsplit(endpoint if "://" in endpoint else f"https://{endpoint}")
    except ValueError as exc:
        raise EndpointError("Yonder endpoint must be an HTTP(S) origin without credentials") from exc
    if url.scheme not in ("http", "https") or url.username or url.password or url.query or url.fragment or url.path not in ("", "/"):
        raise EndpointError("Yonder endpoint must be an HTTP(S) origin without credentials")
    if url.scheme == "http" and url.hostname not in ("127.0.0.1", "localhost", "::1"):
        raise EndpointError("Yonder endpoint requires HTTPS outside loopback")
    return url


def device_socket_url(endpoint: str) -> str:
    url = cloud_url(endpoint)
    scheme = "wss" if url.scheme == "https" else "ws"
    return f"{scheme}://{url.netloc}/ws/device"


class CloudConnection:
    """One outbound connection with exponential backoff; frames are parsed and
    handed to `on_frame`. `on_frame` receives parsed InboundFrames."""

    def __init__(
        self,
        endpoint: str,
        device_token: str,
        on_frame: Callable[[InboundFrame], None],
        on_close: Optional[Callable[[str], None]] = None,
    ) -> None:
        self.endpoint = endpoint
        self.device_token = device_token
        self._on_frame = on_frame
        self._on_close = on_close
        self._socket: Any = None
        self._open = False
        self._stopped = False
        self._retry_task: Optional[asyncio.Task] = None
        self._delay = FIRST_DELAY_S
        self._receive_task: Optional[asyncio.Task] = None
        self._sends: set[asyncio.Task] = set()  # strong refs: sends must not be collected

    @property
    def connected(self) -> bool:
        return self._open

    def start(self) -> None:
        if not self._stopped:
            self._retry_task = asyncio.get_running_loop().create_task(self._run())

    async def _run(self) -> None:
        import websockets

        while not self._stopped:
            try:
                url = device_socket_url(self.endpoint)
                socket = await websockets.connect(
                    url,
                    additional_headers={"authorization": f"Bearer {self.device_token}"},
                    max_size=MAX_PAYLOAD,
                    open_timeout=10,
                )
            except EndpointError:
                if self._open or self._last_reason != "invalid endpoint":
                    self._last_reason = "invalid endpoint"
                    if self._on_close is not None:
                        self._on_close("invalid endpoint")
                return
            except Exception:
                await self._sleep_backoff()
                continue
            self._socket = socket
            self._open = True
            self._delay = FIRST_DELAY_S
            try:
                await self._pump(socket)
            except Exception:
                pass
            finally:
                self._open = False
                self._socket = None
                try:
                    await socket.close()
                except Exception:
                    pass
            if self._stopped:
                return
            if self._on_close is not None:
                self._on_close("disconnected")
            await self._sleep_backoff()

    _last_reason: str = ""

    async def _pump(self, socket: Any) -> None:
        self._flush_hello()
        async for raw in socket:
            if self._stopped:
                return
            frame = parse_frame(raw)
            if frame is not None:
                try:
                    self._on_frame(frame)
                except Exception:
                    pass  # one bad handler must not drop the connection

    def _flush_hello(self) -> None:
        # hello is sent by the owner (WorkBridge/BotBridge) via send() after onOpen;
        # the Python side keeps the same ordering: nothing before the socket opens.
        pass

    async def _sleep_backoff(self) -> None:
        delay = self._delay
        self._delay = min(MAX_DELAY_S, self._delay * 2)
        try:
            await asyncio.sleep(delay)
        except asyncio.CancelledError:
            raise

    def send(self, frame: dict) -> bool:
        socket = self._socket
        if socket is None or not self._open:
            return False
        import json as _json

        try:
            payload = _json.dumps(frame, ensure_ascii=False)
            # websockets asyncio client: send from the loop thread we already are on.
            task = asyncio.get_running_loop().create_task(socket.send(payload))
            self._sends.add(task)
            task.add_done_callback(self._sends.discard)
            return True
        except Exception:
            return False

    def stop(self) -> None:
        self._stopped = True
        if self._retry_task is not None:
            self._retry_task.cancel()
            self._retry_task = None
        socket = self._socket
        self._socket = None
        self._open = False
        if socket is not None:
            asyncio.get_running_loop().create_task(_close_quietly(socket))


async def _close_quietly(socket: Any) -> None:
    try:
        await socket.close()
    except Exception:
        pass
