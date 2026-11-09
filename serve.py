"""Serve Relativity and open it in your browser.

    python serve.py

Press Ctrl+C or close this terminal to stop the server.
"""

from __future__ import annotations

import functools
import http.server
import socket
import sys
import webbrowser
from pathlib import Path

HOST = "127.0.0.1"
PORT = 8000
ROOT = Path(__file__).resolve().parent


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass


def bind(port: int) -> http.server.ThreadingHTTPServer:
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    server = http.server.ThreadingHTTPServer((HOST, port), handler)
    server.daemon_threads = True
    return server


def main() -> int:
    port = PORT
    try:
        server = bind(port)
    except OSError:
        with socket.socket() as probe:
            probe.bind((HOST, 0))
            port = probe.getsockname()[1]
        server = bind(port)

    url = f"http://{HOST}:{port}/"
    print(f"Relativity is running at {url}")
    print("Press Ctrl+C or close this window to stop.")
    webbrowser.open(url)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.shutdown()
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
