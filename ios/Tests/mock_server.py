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
# Reactions and pins sent by the app (UI tests read them back in the dialogue),
# and the dialogues it moved to the archive.
STATE = {"reactions": {}, "pins": {}, "roomReactions": {}, "archived": set()}
# A group for the gesture tests; its messages are an hour old when it starts.
ROOM, ROOM_START = "room_night_walks", int(time.time() * 1000) - 3600000
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


def with_own(reactions, emoji):
    """Reactions after the viewer picks emoji or takes theirs back (None):
    one reaction per person, as lib/message-reactions-store.ts keeps them."""
    result = []
    for reaction in reactions:
        reaction = dict(reaction)
        if reaction["own"]:
            reaction["count"] -= 1
            reaction["own"] = 0
        if reaction["count"] > 0:
            result.append(reaction)
    if emoji:
        for reaction in result:
            if reaction["emoji"] == emoji:
                reaction["count"] += 1
                reaction["own"] = 1
                break
        else:
            result.append({"emoji": emoji, "count": 1, "own": 1})
    return result


def feed():
    """The captured feed with a wide video second: its preview must stay in
    the post (sample data only)."""
    posts = [dict(post) for post in R["feed"]]
    video = {"id": "night-walk.mp4", "type": "video/mp4", "name": "night-walk.mp4", "size": 284443}
    posts.insert(1, dict(posts[0], id="mock-video-post", text="Ночная прогулка по набережной 🌙",
                         media=[video], created=posts[0]["created"] - 60000, likes=12, views=40))
    return posts


def photo(media_id):
    return {"id": media_id, "name": "photo.jpg", "type": "image/jpeg", "size": 184320, "kind": "image"}


def dialogue():
    """The captured dialogue plus photos, a reply and short messages, so the
    screenshots show how the bubbles lay out (sample data only)."""
    base = R["messagesBob"]
    start = max(m["created"] for m in base)
    me, bob = META["me"], META["bob"]
    both = [{"emoji": "🔥", "count": 2, "own": 1}]
    from_bob = [{"emoji": "❤️", "count": 1, "own": 0}]
    extra = [
        (bob, "", [photo("b23ae726-b170-4db7-968e-c7dadbebcdbc")], None, []),
        (bob, "Смотри, какой вид с крыши 😍", [], None, both),
        (me, "Красота! А это моя луна сегодня", [photo("d2d76d31-94a6-496c-8405-251c1042f0b4")], None, from_bob),
        (me, "ок", [], None, []),
        (bob, "Во сколько встречаемся?", [], {"id": "x", "sender": me, "name": "", "text": "Фото", "unavailable": 0}, []),
        (bob, "🔥", [], None, []),
    ]
    messages = [dict(message) for message in base]
    for index, (sender, text, attachments, reply, reactions) in enumerate(extra):
        message = {
            "id": f"message:{sender}:mock-{index}", "sender": sender,
            "recipient": bob if sender == me else me, "text": text,
            "created": start + (index + 1) * 60000, "read": 1, "editedAt": 0, "forwardedName": "",
            "pinnedAt": None, "reactions": reactions, "attachments": attachments,
        }
        if reply:
            message["reply"] = reply
        messages.append(message)
    for message in messages:
        if message["id"] in STATE["reactions"]:
            message["reactions"] = with_own(message["reactions"], STATE["reactions"][message["id"]])
        if STATE["pins"].get(message["id"]):
            message["pinnedAt"] = message["created"]
    return messages


def room():
    """A group of three with a reply in it, shaped as lib/rooms.ts readRoom
    returns it (sample data only)."""
    me, bob, carol = META["me"], META["bob"], "local_carol"
    people = {
        me: ("Алиса Ночная", R["profileAlice"]["avatar"]),
        bob: ("Боб", R["profileBob"]["avatar"]),
        carol: ("Кэрол", ""),
    }
    # Bob has Premium: his name and star take his palette.
    looks = {bob: {"verified": 0, "premium": 1, "boostLevel": 0, "profileTheme": "aurora", "nameGradient": 0}}
    plain = {"verified": 0, "premium": 0, "boostLevel": 0, "profileTheme": "iris", "nameGradient": 0}
    # Many people: the counts show instead of faces.
    popular = [{"emoji": "👍", "count": 5, "own": 0}, {"emoji": "🔥", "count": 2, "own": 1}]
    lines = [
        (bob, "Всем привет! Кто сегодня гуляет?", "", popular),
        (carol, "Я за! Где встречаемся?", "", []),
        (carol, "Могу взять термос с чаем ☕️", "", []),
        (me, "У набережной в девять", "", []),
        (bob, "Отлично, буду", "room:mock-3", []),
        (bob, "Возьму камеру 📷", "", []),
    ]
    messages = []
    for index, (sender, text, reply, reactions) in enumerate(lines):
        message_id = f"room:mock-{index}"
        name, avatar = people[sender]
        if message_id in STATE["roomReactions"]:
            reactions = with_own(reactions, STATE["roomReactions"][message_id])
        messages.append({
            "id": message_id, "roomId": ROOM, "sender": sender, "senderName": name, "senderAvatar": avatar,
            "senderAppearance": looks.get(sender, plain),
            "text": text, "ciphertext": None, "replyTo": reply, "created": ROOM_START + index * 120000,
            "deletedAt": 0, "giveawayId": None, "reactions": reactions,
        })
    members = [{"userId": user, "name": name, "avatar": avatar, "handle": "", "role": "owner" if user == bob else "member",
                "status": "active", "publicKey": None, "joinedAt": ROOM_START} for user, (name, avatar) in people.items()]
    return {"id": ROOM, "name": "Ночные прогулки", "kind": "group", "role": "member", "memberCount": len(members),
            "me": me, "members": members, "messages": messages, "canSend": True, "nextCursor": None}


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
        return R["feedFollowing"] if q.get("mode") == "following" else feed()
    if action == "profile":
        key = q.get("id") or {"bob_night": META["bob"], "night_city": META["channel"]}.get(q.get("handle", ""), META["me"])
        name = {META["bob"]: "profileBob", META["channel"]: "profileChannel"}.get(key, "profileAlice")
        if name != "profileAlice":
            return R[name]
        # Alice's Premium background takes its colours from her cover.
        surface = {"mode": "cover", "first": "#9775cf", "second": "#426b98", "intensity": 30, "musicColor": "cover"}
        return dict(R[name], profileBackground=json.dumps(surface))
    if action == "messages":
        messages = dialogue() if q.get("peer") == META["bob"] else []
        if q.get("includeTheme") == "1":
            return {"messages": messages, "theme": {"shared": "noct", "personal": None, "revision": 1}}
        return messages
    if action == "threads":
        # The archive holds what the app archived (ThreadSwipeTests).
        rows = [dict(row, archivedAt=1 if row["id"] in STATE["archived"] else 0) for row in R["threads"]]
        return [row for row in rows if bool(row["archivedAt"]) == (q.get("archived") == "1")]
    if action in ("comments", "notifications"):
        return [] if q.get("before") else R[action]
    name = SOCIAL.get(action)
    return R[name] if name else {"error": "Не найдено"}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send(self, status, body, content_type="application/json; charset=utf-8", headers=None):
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if not self.head_only:
            self.wfile.write(data)

    def do_HEAD(self):
        self.do_GET(head=True)

    def do_GET(self, head=False):
        self.head_only = head
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
            if q.get("action") == "room":
                return self.send(200, room()) if q.get("id") == ROOM else self.send(404, {"error": "Группа не найдена"})
            return self.send(200, R.get("rooms", {"rooms": []}))
        if url.path.startswith("/api/media/"):
            path = os.path.join(HERE, "Fixtures", "media", os.path.basename(url.path))
        elif url.path.startswith("/assets/"):
            path = os.path.join(PUBLIC, url.path.lstrip("/"))
        else:
            return self.send(404, {"error": "Не найдено"})
        if not os.path.isfile(path):
            return self.send(404, {"error": "Файл не найден"})
        kinds = {".webp": "image/webp", ".png": "image/png", ".json": "application/json",
                 ".tgs": "application/octet-stream", ".mp4": "video/mp4"}
        kind = kinds.get(os.path.splitext(path)[1], "image/jpeg")
        with open(path, "rb") as file:
            data = file.read()
        # Byte ranges, as app/api/media/[id]/route.ts serves them: AVPlayer
        # streams a video only from a server that answers them.
        spec = self.headers.get("Range", "")
        if spec.startswith("bytes="):
            first, _, last = spec[len("bytes="):].split(",")[0].partition("-")
            if first:
                start, end = int(first), int(last) if last else len(data) - 1
            else:
                start, end = max(0, len(data) - int(last)), len(data) - 1
            end = min(end, len(data) - 1)
            return self.send(206, data[start:end + 1], kind,
                             {"Content-Range": f"bytes {start}-{end}/{len(data)}", "Accept-Ranges": "bytes"})
        return self.send(200, data, kind, {"Accept-Ranges": "bytes"})

    def do_POST(self):
        self.head_only = False
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            body = json.loads(raw or b"{}")
        except ValueError:
            body = {}
        path = urlparse(self.path).path
        if path == "/api/social" and isinstance(body, dict):
            if body.get("action") == "messageReaction":
                STATE["reactions"][body.get("id")] = body.get("emoji")
            elif body.get("action") == "messagePin":
                STATE["pins"][body.get("id")] = bool(body.get("value"))
            elif body.get("action") == "archiveChat":
                if body.get("archived"):
                    STATE["archived"].add(body.get("peer"))
                else:
                    STATE["archived"].discard(body.get("peer"))
        elif path == "/api/rooms" and isinstance(body, dict) and body.get("action") == "reaction":
            STATE["roomReactions"][body.get("messageId")] = body.get("emoji")
        self.send(200, {"ok": True})


ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
