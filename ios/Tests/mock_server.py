#!/usr/bin/env python3
"""Serves captured Noctgram API responses to the simulator screenshot job.

Fixtures/fixtures.json holds real responses of a local NoctGram server
(sample accounts only). Usage: mock_server.py PORT in|out PUBLIC_DIR
"""
import json
import os
import sys
import time
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


def gift_list():
    """The captured gifts plus catalog ones, so the gifts screen scrolls a
    full grid (and gift playback is exercised with many tiles)."""
    base = R["gifts"]["gifts"]
    catalog = [c["id"] for c in R["giftCatalog"]["catalog"]]
    gifts = list(base)
    for index, gift_id in enumerate(catalog[:22]):
        source = base[index % len(base)]
        gifts.append(dict(source, id=f"{source['id']}:mock-{index}", giftId=gift_id, message="",
                          hidden=1 if index % 7 == 3 else 0, created=source["created"] - (index + 1) * 3600000))
    return {"gifts": gifts, "next": None}


def photo(media_id):
    return {"id": media_id, "name": "photo.jpg", "type": "image/jpeg", "size": 184320, "kind": "image"}


def dialogue():
    """The captured dialogue plus photos, a reply and short messages, so the
    screenshots show how the bubbles lay out (sample data only)."""
    base = R["messagesBob"]
    start = max(m["created"] for m in base)
    me, bob = META["me"], META["bob"]
    extra = [
        (bob, "", [photo("b23ae726-b170-4db7-968e-c7dadbebcdbc")], None),
        (bob, "Смотри, какой вид с крыши 😍", [], None),
        (me, "Красота! А это моя луна сегодня", [photo("d2d76d31-94a6-496c-8405-251c1042f0b4")], None),
        (me, "ок", [], None),
        (bob, "Во сколько встречаемся?", [], {"id": "x", "sender": me, "name": "", "text": "Фото", "unavailable": 0}),
        (bob, "🔥", [], None),
    ]
    messages = list(base)
    for index, (sender, text, attachments, reply) in enumerate(extra):
        message = {
            "id": f"message:{sender}:mock-{index}", "sender": sender,
            "recipient": bob if sender == me else me, "text": text,
            "created": start + (index + 1) * 60000, "read": 1, "editedAt": 0, "forwardedName": "",
            "pinnedAt": None, "reactions": [], "attachments": attachments,
        }
        if reply:
            message["reply"] = reply
        messages.append(message)
    return messages


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
        messages = dialogue() if q.get("peer") == META["bob"] else []
        if q.get("includeTheme") == "1":
            return {"messages": messages, "theme": {"shared": "noct", "personal": None, "revision": 1}}
        return messages
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
            if q.get("action") == "convert":
                # Sale quote as lib/gift-conversions.ts gives it: 85 % of the price.
                return self.send(200, {"id": q.get("id", ""), "available": True, "reason": None, "originalPrice": 25,
                                       "amount": 21, "fee": 4, "feePercent": 15, "convertedAt": None})
            return self.send(200, R["giftCatalog"] if q.get("action") == "catalog" else gift_list())
        if url.path == "/api/music/activity":
            # Activity is a heartbeat: move the captured times to now.
            now = int(time.time() * 1000)
            if q.get("id", META["me"]) != META["me"]:
                return self.send(200, {"activity": None, "serverTime": now})
            body = json.loads(json.dumps(R["musicActivity"]))
            shift = now - body["serverTime"]
            for key in ("updatedAt", "expiresAt"):
                body["activity"][key] += shift
            body["serverTime"] = now
            return self.send(200, body)
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
        kinds = {".webp": "image/webp", ".png": "image/png", ".json": "application/json", ".tgs": "application/octet-stream"}
        kind = kinds.get(os.path.splitext(path)[1], "image/jpeg")
        with open(path, "rb") as file:
            return self.send(200, file.read(), kind)

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length:
            self.rfile.read(length)
        self.send(200, {"ok": True})


ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
