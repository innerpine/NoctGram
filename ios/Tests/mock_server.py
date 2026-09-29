#!/usr/bin/env python3
"""Serves captured Noctgram API responses to the simulator screenshot job.

Fixtures/fixtures.json holds real responses of a local NoctGram server
(sample accounts only). Usage: mock_server.py PORT in|out PUBLIC_DIR
"""
import io
import json
import math
import os
import struct
import sys
import time
import uuid
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = json.load(open(os.path.join(HERE, "Fixtures", "fixtures.json"), encoding="utf-8"))
META, R = DATA["meta"], DATA["responses"]
PORT, MODE, PUBLIC = int(sys.argv[1]), sys.argv[2], sys.argv[3]

SIGNED_OUT = {"emailEnabled": True, "sitesEnabled": False, "user": None, "challenge": None}
# Reactions and pins sent by the app (UI tests read them back in the dialogue),
# and the dialogues it moved to the archive.
STATE = {"reactions": {}, "pins": {}, "roomReactions": {}, "archived": set(),
         # What the app sent (ChatMediaTests): messages by chat, uploads by id.
         "sent": {}, "uploads": {}, "media": {}, "forwards": [], "roomSent": {}}
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


# What each gift upgrades into (lib/gift-upgrade-data.json), at the site's price.
UPGRADES = {c["id"]: dict(c, price=25) for c in json.load(
    open(os.path.join(HERE, "..", "..", "lib", "gift-upgrade-data.json"), encoding="utf-8"))}


def received(receipt):
    return next((g for g in gift_list()["gifts"] if g["id"] == receipt), None)


def upgrade_preview(receipt):
    """GET /api/gifts?action=upgrade, as lib/gift-upgrades.ts answers it."""
    gift = received(receipt)
    if not gift:
        return 404, {"error": "Подарок не найден"}
    return 200, {"balance": R["giftCatalog"].get("balance", 0), "collection": UPGRADES.get(gift["giftId"]),
                 "collectible": gift.get("collectible")}


def upgrade(body):
    """POST /api/gifts {action: 'upgrade'}: a fixed draw, so screenshots and
    tests always get the same collectible. Nothing is kept, so every run and
    every test starts from the plain gift."""
    gift = received(body.get("id", ""))
    collection = UPGRADES.get(gift["giftId"]) if gift else None
    if not collection:
        return 400, {"error": "Этот подарок нельзя улучшить"}
    if body.get("expectedPrice") != collection["price"]:
        return 409, {"error": "Стоимость улучшения изменилась. Открой подарок заново."}
    pick = lambda items, index: items[index % len(items)]
    collectible = {"model": pick(collection["models"], 11), "backdrop": pick(collection["backdrops"], 5),
                   "symbol": pick(collection["symbols"], 17), "family": collection["id"], "number": 1234,
                   "keepOriginal": bool(body.get("keepOriginal")), "upgradedAt": int(time.time() * 1000)}
    return 200, {"collectible": collectible, "balance": R["giftCatalog"].get("balance", 0) - collection["price"]}


def author(user_id):
    """A commenter as the comments list names them, with their appearance."""
    profile = {META["me"]: R["profileAlice"], META["bob"]: R["profileBob"]}.get(user_id, {})
    keys = ("name", "avatar", "handle", "verified", "premium", "boostLevel", "profileTheme", "nameGradient",
            "ringText", "chromeFlow", "chromeTempo", "avatarMotion", "avatarMotionType")
    return {key: profile[key] for key in keys if key in profile}


def answer(comment_id):
    """The quote of an answered comment (lib/comment-replies.ts)."""
    answered = next((c for c in R["comments"] if c["id"] == comment_id), None)
    if not answered:
        return {"replyTo": comment_id or None, "replyUserId": None, "replyName": None, "replyText": None}
    return {"replyTo": answered["id"], "replyUserId": answered["userId"], "replyName": answered["name"],
            "replyText": answered["text"][:160]}


def comments():
    """The captured comments and Alice's answer to Carol's question."""
    rows = [dict(c, replyTo=None, replyUserId=None, replyName=None, replyText=None) for c in R["comments"]]
    carol = next((c for c in R["comments"] if c["userId"] == "local_carol"), None)
    if carol:
        rows.append(dict(carol, **author(META["me"]), id="mock-answer", userId=META["me"],
                         text="На крыше у Петроградской, перед самым рассветом 🌃",
                         created=carol["created"] + 60000, **answer(carol["id"])))
    return rows


def new_comment(body):
    """POST /api/social {action: 'comment'}: the row the server returns. The
    mock keeps nothing, so every test starts from the same comments."""
    return dict(author(META["me"]), id="mock-" + str(int(time.time() * 1000)), postId=body.get("id", ""),
                userId=META["me"], text=str(body.get("text", "")).strip(), created=int(time.time() * 1000),
                **answer(body.get("replyTo")))


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


# Built-in stickers and emoji of the site (lib/sticker-catalog.json), as
# /api/stickers lists and resolves them.
CATALOG = json.load(open(os.path.join(HERE, "..", "..", "lib", "sticker-catalog.json"), encoding="utf-8"))


def sticker_info(pack, item):
    info = {"ref": f"b:{pack['id']}:{item['slug']}", "packRef": "b:" + pack["id"], "emoji": item["emoji"],
            "format": item["format"], "src": item["path"], "w": item.get("w", 512), "h": item.get("h", 512),
            "available": True}
    if pack["type"] == "emoji":
        info["token"] = f":noct_{item['slug']}:"
    return info


def pack_info(pack):
    return {"ref": "b:" + pack["id"], "id": pack["id"], "shortName": pack["id"], "title": pack["title"],
            "type": pack["type"], "builtin": True, "own": False, "installed": True,
            "stickers": [sticker_info(pack, item) for item in pack["items"]]}


def resolve(ref):
    for pack in CATALOG["packs"]:
        for item in pack["items"]:
            if ref == f"b:{pack['id']}:{item['slug']}":
                return sticker_info(pack, item)
    return {"ref": ref, "packRef": "", "emoji": "", "format": "webp", "src": "", "w": 512, "h": 512, "available": False}


def stickers(q):
    action = q.get("action")
    if action == "panel":
        # Premium, with two favourites: the emoji panel is open.
        return 200, {"packs": [], "favorites": [resolve("b:utya:birthday"), resolve("b:monkey:peek")], "premium": True,
                     "limits": {"packs": 20, "installed": 30, "stickers": 120, "emoji": 200, "favorites": 10}}
    if action == "builtin":
        return 200, {"packs": [pack_info(pack) for pack in CATALOG["packs"]]}
    if action == "pack":
        pack = next((p for p in CATALOG["packs"] if p["id"] == q.get("name")), None)
        return (200, pack_info(pack)) if pack else (404, {"error": "Набор не найден"})
    if action == "resolve":
        return 200, {"stickers": [resolve(ref) for ref in q.get("refs", "").split(",") if ref]}
    return 400, {"error": "Неизвестное действие"}


def tone():
    """Six seconds of a soft tone in WAV: the voice messages of the mock."""
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(8000)
        out.writeframes(b"".join(struct.pack("<h", int(6000 * math.sin(2 * math.pi * 330 * i / 8000) * abs(math.sin(i / 2600))))
                                 for i in range(48000)))
    return buffer.getvalue()


VOICE = tone()
WAVE = "03579bdfhjlnpqrstsrqpnljhfdb97531" * 3


def voice(media_id="voice-sample.wav", seconds=2):
    return {"id": media_id, "name": "voice.m4a", "type": "audio/wav", "size": len(VOICE), "kind": "voice",
            "duration": seconds * 1000, "waveform": WAVE[:100]}


def round_video():
    return {"id": "night-walk.mp4", "name": "video-message.mp4", "type": "video/mp4", "size": 284443, "kind": "round",
            "duration": 8000, "waveform": ""}


def chat_message(message_id, sender, recipient, created, text="", **extra):
    message = {"id": message_id, "sender": sender, "recipient": recipient, "text": text, "created": created,
               "read": 1, "editedAt": 0, "forwardedName": "", "forwardedSender": None, "listenedAt": 0,
               "pinnedAt": None, "reactions": [], "attachments": []}
    message.update(extra)
    return message


def media_dialogue():
    """A dialogue with Carol that holds every new kind of message: voice
    (heard and not), a round video, stickers, big premium emoji, a forward
    and a shared post (sample data only)."""
    me, carol = META["me"], "local_carol"
    start = int(time.time() * 1000) - 50 * 60000
    rows = [
        chat_message("message:local_carol:media-0", carol, me, start, "Смотри, что нашла на канале", postShare={"id": META["post"]}),
        chat_message("message:local_alice:media-1", me, carol, start + 60000, sticker="b:utya:birthday"),
        chat_message("message:local_carol:media-2", carol, me, start + 120000, attachments=[voice()], listenedAt=start + 130000),
        chat_message("message:local_alice:media-3", me, carol, start + 180000, attachments=[voice("voice-sample.wav", 7)]),
        chat_message("message:local_carol:media-4", carol, me, start + 240000, attachments=[round_video()]),
        chat_message("message:local_carol:media-5", carol, me, start + 300000, ":noct_fire::noct_star_gold::noct_duck:"),
        chat_message("message:local_alice:media-6", me, carol, start + 360000, "Кто идёт гулять сегодня?",
                     forwardedName="Боб", forwardedSender=META["bob"]),
        chat_message("message:local_carol:media-7", carol, me, start + 420000, sticker="b:monkey:peek",
                     reply={"id": "message:local_alice:media-6", "sender": me, "name": "Алиса", "text": "Кто идёт гулять сегодня?",
                            "unavailable": False, "quote": "гулять"}),
    ]
    return rows + STATE["sent"].get(carol, [])


def saved():
    """«Избранное»: a note, then what the app saved or forwarded there."""
    me = META["me"]
    start = int(time.time() * 1000) - 3 * 3600000
    rows = [chat_message("message:local_alice:saved-0", me, me, start, "Идеи для канала: ночные маршруты, рассветы, крыши 🌃")]
    return rows + STATE["sent"].get(me, [])


def remember(peer, body, sender=None):
    """A message the app sent (POST /api/social {action: 'message'})."""
    me = META["me"]
    key = body.get("key") or uuid.uuid4().hex
    attachments = [STATE["uploads"][a] for a in body.get("attachments", []) if a in STATE["uploads"]]
    message = chat_message(f"message:{me}:{key}", me, peer, int(time.time() * 1000), str(body.get("text", "")).strip(),
                           attachments=attachments, listenedAt=0)
    if body.get("sticker"):
        message["sticker"] = body["sticker"]
    STATE["sent"].setdefault(peer, [])
    if not any(m["id"] == message["id"] for m in STATE["sent"][peer]):
        STATE["sent"][peer].append(message)
    return message


def upload(headers, raw):
    """POST /api/chat-upload: multipart with one file, as lib/chat-uploads.ts
    answers it; the file is served from memory afterwards."""
    boundary = headers.get("Content-Type", "").split("boundary=")[-1].encode()
    fields, data, content_type = {}, b"", "application/octet-stream"
    for part in raw.split(b"--" + boundary):
        head, _, body = part.partition(b"\r\n\r\n")
        if not body:
            continue
        body = body[:-2] if body.endswith(b"\r\n") else body
        name = head.split(b'name="')[1].split(b'"')[0].decode() if b'name="' in head else ""
        if name == "file":
            data = body
            content_type = head.split(b"Content-Type: ")[-1].decode().strip() if b"Content-Type: " in head else "application/octet-stream"
        elif name:
            fields[name] = body.decode()
    upload_id = str(uuid.uuid4())
    intent = fields.get("intent")
    kind = intent or ("image" if content_type.startswith("image/") else "video" if content_type.startswith("video/") else "file")
    item = {"id": upload_id, "name": "upload", "type": content_type, "size": len(data), "kind": kind}
    if intent:
        item["duration"] = int(fields.get("duration", "0"))
        item["waveform"] = fields.get("waveform", "") if intent == "voice" else ""
    STATE["uploads"][upload_id] = item
    STATE["media"][upload_id] = (content_type, data)
    return item


def post_previews(ids):
    """GET /api/social?action=postPreviews: the feed posts the viewer may see."""
    posts = {post["id"]: post for post in feed() + [R["post"]] if isinstance(post, dict)}
    rows = []
    for post_id in ids.split(","):
        post = posts.get(post_id)
        if not post:
            continue
        media = post.get("media")
        media = json.loads(media) if isinstance(media, str) and media else (media or [])
        rows.append(dict(author(post.get("userId")), id=post["id"], userId=post.get("userId"), name=post.get("name"),
                         avatar=post.get("avatar", ""), handle=post.get("handle", ""), kind=post.get("kind", "person"),
                         text=post.get("text", "")[:400], media=media[0] if media else None, mediaCount=len(media),
                         adult=post.get("adult", 0), poll=bool(post.get("poll")), code=bool(post.get("code")),
                         created=post.get("created", 0)))
    return rows


def forward(body):
    """POST /api/chat-forward: copies into «Избранное» are kept, so the test
    can open it and find them (lib/chat-forward.ts)."""
    me = META["me"]
    STATE["forwards"].append(body)
    source = body.get("source", {})
    messages = []
    if "dm" in source:
        peer = source["dm"].get("peer")
        pool = dialogue() if peer == META["bob"] else media_dialogue() if peer == "local_carol" else saved()
        messages = [m for m in pool if m["id"] in source["dm"].get("ids", [])]
    results = []
    for index, target in enumerate(body.get("targets", [])):
        if "dm" in target and target["dm"].get("peer") == me:
            for position, original in enumerate(messages):
                copy = dict(original, id=f"forward:{me}:{body.get('key')}-{index}:{position}", sender=me, recipient=me,
                            created=int(time.time() * 1000) + position, reactions=[], pinnedAt=None,
                            forwardedName=original.get("forwardedName") or {META["bob"]: "Боб", "local_carol": "Кэрол"}.get(original["sender"], "Алиса Ночная"),
                            forwardedSender=original.get("forwardedSender") or original["sender"])
                STATE["sent"].setdefault(me, []).append(copy)
        results.append({"target": target, "ok": True, "ids": []})
    return {"results": results}


def room_media():
    """«Кино по пятницам»: a group with a voice message, a round video, a
    sticker, photos and a forward, as lib/rooms.ts readRoom returns it."""
    me, bob, carol = META["me"], META["bob"], "local_carol"
    start = int(time.time() * 1000) - 40 * 60000
    people = {me: ("Алиса Ночная", R["profileAlice"]["avatar"]), bob: ("Боб", R["profileBob"]["avatar"]), carol: ("Кэрол", "")}
    looks = {bob: {"verified": 0, "premium": 1, "boostLevel": 0, "profileTheme": "aurora", "nameGradient": 0}}
    plain = {"verified": 0, "premium": 0, "boostLevel": 0, "profileTheme": "iris", "nameGradient": 0}
    lines = [
        (bob, "Что смотрим в пятницу?", [], {}),
        (carol, "", [voice("voice-sample.wav", 5)], {}),
        (bob, "", [photo("b23ae726-b170-4db7-968e-c7dadbebcdbc"), photo("d2d76d31-94a6-496c-8405-251c1042f0b4")], {}),
        (carol, "", [], {"sticker": "b:holiday:congratulations"}),
        (bob, "", [round_video()], {}),
        (me, "Я за «Дюну»", [], {"forwardedName": "Кэрол", "forwardedFrom": carol}),
    ]
    messages = []
    for index, (sender, text, attachments, extra) in enumerate(lines):
        name, avatar = people[sender]
        messages.append(dict({
            "id": f"media:{index}", "roomId": "room_media", "sender": sender, "senderName": name, "senderAvatar": avatar,
            "senderAppearance": looks.get(sender, plain), "text": text, "ciphertext": None, "replyTo": None,
            "created": start + index * 180000, "deletedAt": 0, "giveawayId": None, "reactions": [], "attachments": attachments,
        }, **extra))
    messages += STATE["roomSent"].get("room_media", [])
    return {"id": "room_media", "name": "Кино по пятницам", "kind": "group", "role": "member", "memberCount": 3,
            "me": me, "members": [], "messages": messages, "canSend": True, "nextCursor": None, "forum": False}


def rooms_list(archived):
    """Both groups of the mock in the chat list and the forward sheet."""
    if archived:
        return {"rooms": []}
    now = int(time.time() * 1000)
    return {"rooms": [
        {"id": ROOM, "kind": "group", "name": "Ночные прогулки", "avatar": "", "username": None, "memberCount": 3,
         "unread": 0, "archivedAt": 0, "forum": False, "role": "member",
         "lastMessage": {"id": "room:mock-5", "text": "Возьму камеру 📷", "created": ROOM_START + 5 * 120000, "sender": META["bob"]}},
        {"id": "room_media", "kind": "group", "name": "Кино по пятницам", "avatar": "", "username": None, "memberCount": 3,
         "unread": 0, "archivedAt": 0, "forum": False, "role": "member",
         "lastMessage": {"id": "media:5", "text": "Я за «Дюну»", "created": now - 25 * 60000, "sender": META["me"]}},
    ]}


def chat_search(q):
    """GET /api/chat-search?scope=all: messages of the mock's chats whose
    text holds the query (lib/message-search.ts)."""
    term = q.get("q", "").strip().lower()
    if not term:
        return 400, {"error": "Запрос — от 1 до 100 символов"}
    names = {META["bob"]: ("Боб", R["profileBob"]["avatar"]), "local_carol": ("Кэрол", ""), META["me"]: ("Алиса Ночная", R["profileAlice"]["avatar"])}
    items = []
    for peer, messages in ((META["bob"], dialogue()), ("local_carol", media_dialogue()), (META["me"], saved())):
        for message in messages:
            if term in message["text"].lower():
                sender = names.get(message["sender"], ("Алиса Ночная", ""))[0]
                items.append({"kind": "dm", "id": message["id"], "chatId": peer, "chatName": names[peer][0], "chatAvatar": names[peer][1],
                              "sender": message["sender"], "senderName": sender, "text": message["text"], "created": message["created"]})
    for message in room()["messages"]:
        if term in message["text"].lower():
            items.append({"kind": "room", "id": message["id"], "chatId": ROOM, "chatName": "Ночные прогулки", "chatAvatar": "",
                          "forum": False, "sender": message["sender"], "senderName": message["senderName"], "text": message["text"],
                          "created": message["created"]})
    if q.get("scope") == "chat":
        chat = q.get("peer") or q.get("room")
        items = [item for item in items if item["chatId"] == chat]
    items.sort(key=lambda item: -item["created"])
    return 200, {"items": items[:30], "next": None, "total": len(items)}


FOLDERS = {"folders": [
    {"id": "folder-people", "title": "Личные", "emoji": "💬", "position": 0, "includePersonal": True, "includeGroups": False,
     "includeSecret": False, "excludeRead": False, "excludeArchived": True, "includePeers": [], "excludePeers": []},
    {"id": "folder-groups", "title": "Группы", "emoji": "👥", "position": 1, "includePersonal": False, "includeGroups": True,
     "includeSecret": False, "excludeRead": False, "excludeArchived": True, "includePeers": [], "excludePeers": []},
], "limit": 10}


def person(key, **extra):
    """A profile fixture as the team's lists give people (sample data only)."""
    profile = R[key]
    fields = {name: profile.get(name) for name in ("id", "name", "avatar", "handle", "kind", "verified", "premium",
                                                   "boostLevel", "profileTheme", "nameGradient")}
    fields["kind"] = fields["kind"] or "person"
    return dict(fields, **extra)


def team(action, q):
    """The team's cabinet (lib/moderation.ts, lib/content-moderation.ts,
    lib/antispam-moderation.ts, lib/administration.ts), sample data only."""
    now = int(time.time() * 1000)
    hour = 3600000
    if action == "moderationUsers":
        people = [
            person("profileBob", mode="read_only", reason="Реклама в комментариях", expiresAt=now + 20 * hour,
                   restrictedAt=now - 4 * hour, moderator=0, canRestrict=True, ownerId=None, ownerName=None, ownerHandle=None),
            person("profileChannel", mode=None, reason=None, expiresAt=None, restrictedAt=None, moderator=0,
                   canRestrict=True, ownerId=META["me"], ownerName="Алиса Ночная", ownerHandle="alice_night"),
            person("profileAlice", mode=None, reason=None, expiresAt=None, restrictedAt=None, moderator=1,
                   canRestrict=False, ownerId=None, ownerName=None, ownerHandle=None),
        ]
        if q.get("id"):
            people = [p for p in people if p["id"] == q["id"]]
        elif q.get("q"):
            text = q["q"].lstrip("@").lower()
            people = [p for p in people if text in p["name"].lower() or text in p["handle"]]
        return {"people": people, "hasMore": False, "nextCursor": None}
    if action == "moderationHistory":
        return [{"id": "event-1", "mode": "read_only", "reason": "Реклама в комментариях", "created": now - 4 * hour,
                 "moderatorHandle": "alice_night"}] if q.get("id") == META["bob"] else []
    if action == "moderationAppeals":
        return [{"id": "appeal-1", "userId": META["bob"], "handle": "bob_night", "name": "Боб",
                 "text": "Это была ссылка на мой собственный фотоблог, больше не буду.", "reason": "Реклама в комментариях",
                 "mode": "read_only", "status": "pending", "reviewNote": "", "created": now - 2 * hour}]
    if action == "moderationReports":
        reports = [
            {"id": "report-1", "targetType": "post", "targetId": META["post"], "postId": META["post"], "authorId": META["bob"],
             "name": "Боб", "kind": "person", "handle": "bob_night", "reporterHandle": "carol_sky", "reviewerHandle": None,
             "text": "Подпишись на мой канал и получи 1000 звёзд бесплатно!", "reason": "Спам или реклама",
             "status": "new", "reviewNote": "", "created": now - hour, "available": 1},
            {"id": "report-2", "targetType": "comment", "targetId": "comment-1", "postId": META["post"], "authorId": "local_carol",
             "name": "Кэрол", "kind": "person", "handle": "carol_sky", "reporterHandle": "bob_night", "reviewerHandle": "alice_night",
             "text": "Ну и фото, так себе", "reason": "Оскорбления или травля", "status": "reviewing", "reviewNote": "",
             "created": now - 3 * hour, "available": 1},
        ]
        status = q.get("status", "all")
        return [r for r in reports if status == "all" or r["status"] == status]
    if action == "moderationRemovals":
        return [{"id": "removal-1", "targetType": "post", "handle": "bob_night", "moderatorHandle": "alice_night",
                 "text": "Купи подписчиков дёшево", "reason": "Спам или реклама", "created": now - 26 * hour}]
    if action == "spamQueue":
        items = [{"id": "spam-1", "kind": "comment", "targetId": "comment-2", "actorId": "local_carol", "contextId": META["post"],
                  "payload": {"text": "Лучшие скидки на spam.example", "media": "[]"}, "text": "Лучшие скидки на spam.example",
                  "reasons": ["Рекламный домен spam.example", "Повтор одного текста"], "status": "pending", "created": now - 30 * 60000,
                  "reviewedAt": 0, "reviewedBy": None, "note": "", "name": "Кэрол", "handle": "carol_sky",
                  "contextName": "Комментарии к публикации"}]
        status = q.get("status", "pending")
        return {"settings": {"domains": ["spam.example", "cheap-followers.example"], "raidUntil": 0, "updated": 1},
                "items": [i for i in items if i["status"] == status], "hasMore": False}
    if action == "administration":
        people = [
            person("profileAlice", moderator=1, administrator=1, balance=12500),
            person("profileBob", moderator=0, administrator=0, balance=840),
            person("profileChannel", moderator=0, administrator=0, balance=0),
        ]
        events = [{"id": "admin-1", "action": "stars", "amount": 500, "reason": "Награда за помощь в тестировании",
                   "created": now - 5 * hour, "actorName": "Алиса Ночная", "name": "Боб", "handle": "bob_night", "payload": None}]
        return {"people": people, "more": False, "events": events}
    return None


def social(q):
    action = q.get("action", "feed")
    staff = team(action, q)
    if staff is not None:
        return staff
    if action == "bootstrap":
        # The viewer is on the team: the profile tab shows the cabinet.
        data = json.loads(json.dumps(R["bootstrap"]))
        data["me"].update(canModerate=True, canAdmin=True)
        return data
    if action == "feed":
        if q.get("before"):
            return []
        if q.get("media") == "1":
            return R["feedAliceMedia"]
        user = q.get("user")
        if user:
            return R.get({META["me"]: "feedAlice", META["bob"]: "feedBob", META["channel"]: "feedChannel"}.get(user, ""), [])
        return R["feedFollowing"] if q.get("mode") == "following" else feed()
    if action == "profile" and q.get("id") == "local_carol":
        return dict(R["profileBob"], id="local_carol", name="Кэрол", handle="carol_sky", avatar="", cover="", premium=0)
    if action == "profile":
        key = q.get("id") or {"bob_night": META["bob"], "night_city": META["channel"]}.get(q.get("handle", ""), META["me"])
        name = {META["bob"]: "profileBob", META["channel"]: "profileChannel"}.get(key, "profileAlice")
        if name != "profileAlice":
            return R[name]
        # Alice's Premium background takes its colours from her cover; she is
        # on the team.
        surface = {"mode": "cover", "first": "#9775cf", "second": "#426b98", "intensity": 30, "musicColor": "cover"}
        return dict(R[name], profileBackground=json.dumps(surface), canModerate=True, canAdmin=True)
    if action == "messages":
        peer = q.get("peer")
        messages = (dialogue() + STATE["sent"].get(META["bob"], []) if peer == META["bob"]
                    else media_dialogue() if peer == "local_carol" else saved() if peer == META["me"] else [])
        if q.get("includeTheme") == "1":
            return {"messages": messages, "theme": {"shared": "noct", "personal": None, "revision": 1}}
        return messages
    if action == "postPreviews":
        return post_previews(q.get("ids", ""))
    if action == "threads":
        # The archive holds what the app archived (ThreadSwipeTests), and
        # «Избранное» is the dialogue with oneself.
        notes = saved()
        own = dict(R["threads"][0], **author(META["me"]), id=META["me"], lastText=notes[-1]["text"] or "Сообщение",
                   lastTime=notes[-1]["created"], unread=0, lastSeen=None)
        rows = [dict(row, archivedAt=1 if row["id"] in STATE["archived"] else 0) for row in R["threads"] + [own]]
        return [row for row in rows if bool(row["archivedAt"]) == (q.get("archived") == "1")]
    if action == "comments":
        return [] if q.get("before") else comments()
    if action == "notifications":
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
            if q.get("action") == "upgrade":
                return self.send(*upgrade_preview(q.get("id", "")))
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
        if url.path == "/api/stickers":
            return self.send(*stickers(q))
        if url.path == "/api/chat-search":
            return self.send(*chat_search(q))
        if url.path == "/api/chat-folders":
            return self.send(200, FOLDERS)
        if url.path == "/api/rooms":
            if q.get("action") == "room":
                if q.get("id") == "room_media":
                    return self.send(200, room_media())
                return self.send(200, room()) if q.get("id") == ROOM else self.send(404, {"error": "Группа не найдена"})
            return self.send(200, rooms_list(q.get("archived") == "1"))
        media_id = os.path.basename(url.path)
        if url.path == "/api/media/voice-sample.wav":
            return self.send(200, VOICE, "audio/wav", {"Accept-Ranges": "bytes"})
        if url.path.startswith("/api/media/") and media_id in STATE["media"]:
            kind, data = STATE["media"][media_id]
            return self.send(200, data, kind, {"Accept-Ranges": "bytes"})
        if url.path.startswith("/api/media/"):
            path = os.path.join(HERE, "Fixtures", "media", media_id)
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
        if path == "/api/chat-upload":
            return self.send(200, upload(self.headers, raw))
        if path == "/api/chat-forward" and isinstance(body, dict):
            return self.send(200, forward(body))
        if path == "/api/stickers":
            return self.send(200, {"ok": True})
        if path == "/api/rooms" and isinstance(body, dict) and body.get("action") == "send":
            me = META["me"]
            attachments = [STATE["uploads"][a] for a in body.get("attachments", []) if a in STATE["uploads"]]
            message = {"id": body.get("key"), "roomId": body.get("id"), "sender": me, "senderName": "Алиса Ночная",
                       "senderAvatar": R["profileAlice"]["avatar"], "senderAppearance": {}, "text": body.get("text", ""),
                       "ciphertext": None, "replyTo": body.get("replyTo"), "created": int(time.time() * 1000), "deletedAt": 0,
                       "giveawayId": None, "reactions": [], "attachments": attachments}
            if body.get("sticker"):
                message["sticker"] = body["sticker"]
            STATE["roomSent"].setdefault(body.get("id"), []).append(message)
            return self.send(200, {"id": body.get("key")})
        if path == "/api/social" and isinstance(body, dict):
            if body.get("action") == "comment":
                return self.send(200, new_comment(body))
            if body.get("action") == "message":
                message = remember(body.get("id"), body)
                return self.send(200, {"id": message["id"]})
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
        elif path == "/api/gifts" and isinstance(body, dict) and body.get("action") == "upgrade":
            return self.send(*upgrade(body))
        self.send(200, {"ok": True})


ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
