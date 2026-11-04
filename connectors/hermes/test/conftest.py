"""Make the connector importable as the ``hermes`` package for pytest runs
from the repo root: the package's parent (``connectors/``) goes on sys.path."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
