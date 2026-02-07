#!/usr/bin/env python3
"""
Simple HTTP server to serve the spell tree viewer.
Serves from the SpellTreeBuilder directory so all paths work correctly.
"""

import http.server
import socketserver
import webbrowser
import os
import socket
from pathlib import Path

def find_free_port(start=8080, end=8099):
    """Find a free port in the given range."""
    for port in range(start, end):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(('', port))
                return port
        except OSError:
            continue
    return None

# Change to the correct directory
os.chdir(Path(__file__).parent.parent.parent)  # Go to workspace root

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def log_message(self, format, *args):
        pass  # Suppress request logging

def main():
    port = find_free_port()
    if not port:
        print("ERROR: Could not find an available port (8080-8099)")
        return

    print(f"Starting spell tree viewer server on port {port}...")
    print(f"Working directory: {os.getcwd()}")
    print(f"\nOpen in browser: http://localhost:{port}/tools/SpellTreeBuilder/tree_viewer.html")
    print(f"\nPress Ctrl+C to stop the server.\n")

    with socketserver.TCPServer(("", port), Handler) as httpd:
        # Open browser automatically
        webbrowser.open(f"http://localhost:{port}/tools/SpellTreeBuilder/tree_viewer.html")
        httpd.serve_forever()

if __name__ == '__main__':
    main()
