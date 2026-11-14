#!/usr/bin/env python3
"""
Local Development & Preview Server for Init7 TV Tizen App.
Serves tizen/ on http://localhost:8080 and proxies /init7-api/* to https://api.tv.init7.net/api/*
so you can test live Init7 HLS playback and live EPG in any desktop browser without CORS blocks.
"""
import http.server
import os
import ssl
import sys
import urllib.request
import urllib.error

PORT = int(os.environ.get("PORT", "8080"))
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "tizen"))
UPSTREAM_API = "https://api.tv.init7.net/api"


class Init7DevHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT_DIR, **kwargs)

    def do_GET(self):
        if self.path.startswith("/init7-api/"):
            rel_path = self.path[len("/init7-api"):]
            target_url = UPSTREAM_API + rel_path
            try:
                req = urllib.request.Request(
                    target_url,
                    headers={"User-Agent": "Init7TV-Tizen/1.0", "Accept": "*/*"}
                )
                ctx = ssl.create_default_context()
                with urllib.request.urlopen(req, timeout=8, context=ctx) as resp:
                    body = resp.read()
                    content_type = resp.headers.get("Content-Type", "application/json")
                    self.send_response(resp.status)
                    self.send_header("Content-Type", content_type)
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.send_header("Cache-Control", "no-cache")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
            except urllib.error.HTTPError as e:
                self.send_response(e.code)
                self.end_headers()
            except Exception as e:
                self.send_response(502)
                self.end_headers()
                self.wfile.write(str(e).encode("utf-8"))
            return

        return super().do_GET()

    def log_message(self, fmt, *args):
        sys.stdout.write("[dev-server] %s - %s\n" % (self.address_string(), fmt % args))


if __name__ == "__main__":
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    with http.server.ThreadingHTTPServer(("0.0.0.0", PORT), Init7DevHandler) as httpd:
        print(f"Init7 TV Preview Server running at http://localhost:{PORT}")
        httpd.serve_forever()
