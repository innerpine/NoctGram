#!/usr/bin/env python3
"""Serves captured Noctgram API responses to the simulator screenshot job.

Fixtures/fixtures.json holds real responses of a local NoctGram server
(sample accounts only). Usage: mock_server.py PORT in|out PUBLIC_DIR
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = json.load(open(os.path.join(HERE, "Fixtures", "fixtures.json"), encoding="utf-8"))
META, R = DATA["meta"], DATA["responses"]
PORT, MODE, PUBLIC = int(sys.argv[1]), sys.argv[2], sys.argv[3]

SIGNED_OUT = {"emailEnabled": True, "sitesEnabled": False, "user": None, "challenge": None}
SOCIAL = {
    "bootstrap": "bootstrap",
    "post": "post",
    "threads": "threads",
    "threadsUnread": "threadsUnread",
    "messageAccess": "messageAccess",
    "notificationCount": "notificationCount",
    "wallet": "wallet",
    "connections": "followers",
    "myChannels": "myChannels",
    "privacy": "privacy",
    "topics": "topics",
    "people": "people",
    "channels": "channels",
}


def social(q):
    action = q.get("action", "feed")
    if action == "feed":
        if q.get("before"):
            return []
        if q.get("media") == "1":
            return R["feedAliceMedia"]
        user = q.get("user")
        if user:
            return R.get({META["me"]: "feedAlice", META["bob"]: "feedBob", META["channel"]: "feedChannel"}.get(user, ""), [])
        return R["feedFollowing" if q.get("mode") == "following" else "feed"]
    if action == "profile":
        key = q.get("id") or {"bob_night": META["bob"], "night_city": META["channel"]}.get(q.get("handle", ""), META["me"])
        return R[{META["bob"]: "profileBob", META["channel"]: "profileChannel"}.get(key, "profileAlice")]
    if action == "messages":
        return R["messagesBob"] if q.get("peer") == META["bob"] else []
    if action in ("comments", "notifications"):
        return [] if q.get("before") else R[action]
    name = SOCIAL.get(action)
    return R[name] if name else {"error": "Не найдено"}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send(self, status, body, content_type="application/json; charset=utf-8"):
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        url = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        if url.path == "/api/auth/session":
            return self.send(200, R["session"] if MODE == "in" else SIGNED_OUT)
        if MODE != "in":
            return self.send(401, {"error": "Войдите, чтобы продолжить"})
        if url.path == "/api/social":
            return self.send(200, social(q))
        if url.path == "/api/gifts":
            return self.send(200, R["giftCatalog" if q.get("action") == "catalog" else "gifts"])
        if url.path == "/api/rooms":
            return self.send(200, R.get("room" if q.get("action") == "room" else "rooms", {"rooms": []}))
        if url.path.startswith("/api/media/"):
            path = os.path.join(HERE, "Fixtures", "media", os.path.basename(url.path))
        elif url.path.startswith("/assets/"):
            path = os.path.join(PUBLIC, url.path.lstrip("/"))
        else:
            return self.send(404, {"error": "Не найдено"})
        if not os.path.isfile(path):
            return self.send(404, {"error": "Файл не найден"})
        kind = "image/webp" if path.endswith(".webp") else "image/png" if path.endswith(".png") else "image/jpeg"
        with open(path, "rb") as file:
            return self.send(200, file.read(), kind)

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length:
            self.rfile.read(length)
        self.send(200, {"ok": True})


ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
