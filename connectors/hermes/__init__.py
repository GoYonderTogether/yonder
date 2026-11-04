"""Yonder connector: registers this Hermes gateway with a Yonder account.

The inbound platform adapter is registered here via ``register(ctx)``; the
session-driving adapter (the only file allowed to know Hermes's API shapes,
spec 23 §4) lives in ``adapter.py``. See that module's docstring for the
protocol subset.
"""

from .platform_adapter import register

__all__ = ["register"]
