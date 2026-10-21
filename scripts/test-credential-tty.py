#!/usr/bin/env python3
"""Real PTY acceptance for built CLI; isolated temp homes, test-only values."""
import json
import os
from pathlib import Path
import pty
import select
import subprocess
import tempfile
import termios
import time

CLI = str(Path(__file__).resolve().parents[1] / 'packages/cli/dist/index.js')


def run_case(home, payload, success):
    master, slave = pty.openpty()
    child = subprocess.Popen(['node', CLI, 'credentials', 'set', 'tty-test', '--home', home],
                             stdin=slave, stdout=slave, stderr=slave)
    output = b''
    deadline = time.monotonic() + 10
    try:
        while b'Secret (hidden;' not in output:
            assert time.monotonic() < deadline, 'prompt timeout'
            if select.select([master], [], [], .1)[0]:
                output += os.read(master, 4096)
        assert not (termios.tcgetattr(slave)[3] & termios.ECHO), 'echo must be disabled'
        os.write(master, payload)
        while child.poll() is None:
            assert time.monotonic() < deadline, 'exit timeout'
            if select.select([master], [], [], .1)[0]:
                output += os.read(master, 4096)
        while select.select([master], [], [], .05)[0]:
            output += os.read(master, 4096)
        assert child.returncode == (0 if success else 1), 'unexpected exit'
        assert b'test-only-tty-value' not in output, 'value was echoed'
        assert termios.tcgetattr(slave)[3] & termios.ECHO, 'echo not restored'
    finally:
        if child.poll() is None:
            child.kill()
            child.wait()
        os.close(master)
        os.close(slave)


with tempfile.TemporaryDirectory(prefix='yonder-tty-') as root:
    for kind in ['save', 'cancel', 'empty']:
        home = str(Path(root).resolve() / kind)
        subprocess.run(['node', CLI, 'init', home], check=True, capture_output=True)
        run_case(home, {'save': b'test-only-tty-value\r',
                        'cancel': b'test-only-tty-value\x03', 'empty': b'\r'}[kind], kind == 'save')
        auth = Path(home) / '.yonder/auth.json'
        if kind == 'save':
            assert json.loads(auth.read_text())['tty-test']['key'] == 'test-only-tty-value'
            assert auth.stat().st_mode & 0o777 == 0o600
        else:
            assert not auth.exists(), 'cancel/empty must not create store'
    home = str(Path(root).resolve() / 'save')
    result = subprocess.run(['node', CLI, 'credentials', 'set', 'pipe-test', '--home', home],
                            input=b'test-only-tty-value\n', capture_output=True)
    assert result.returncode == 1 and b'test-only-tty-value' not in result.stdout + result.stderr
print('PASS: PTY hidden save, Ctrl-C, empty, echo restoration, non-TTY refusal (4 cases)')
