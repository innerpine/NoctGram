package com.noctgram.app

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/** Personal dialogues and groups in one list, newest first. Also feeds the tab bar's unread badge. */
class ChatList(private val api: NoctApi, private val scope: CoroutineScope) {
    var items by mutableStateOf(listOf<JSONObject>())
        private set
    var loading by mutableStateOf(false)
        private set
    var error by mutableStateOf("")
        private set
    val unread get() = items.sumOf { it.optInt("unread") }

    fun reload() {
        loading = true
        scope.launch {
            try {
                val direct = api.get("/api/social", mapOf("action" to "threads", "archived" to "0")).objects("items")
                // Groups are a separate service; the dialogues must not disappear when it fails.
                val rooms = runCatching { api.get("/api/rooms", mapOf("action" to "list", "archived" to "0")).objects("rooms") }
                    .getOrDefault(emptyList())
                    .map { room ->
                        val last = room.optJSONObject("lastMessage")
                        room.put("room", true)
                            .put("lastText", when {
                                last == null -> room.optString("label")
                                room.optString("kind") == "secret" -> "Зашифрованное сообщение"
                                else -> last.optString("text")
                            })
                            .put("lastTime", last?.optLong("created") ?: room.optLong("updatedAt"))
                    }
                items = (direct + rooms).sortedByDescending { it.optLong("lastTime") }
                error = ""
            } catch (failure: ApiException) {
                error = failure.message.orEmpty()
            }
            loading = false
        }
    }

    fun clear() {
        items = emptyList()
        error = ""
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatListScreen(model: AppModel) {
    val chats = model.chats
    Column(Modifier.fillMaxSize()) {
        Text("Чаты", fontSize = 21.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(20.dp, 16.dp, 20.dp, 8.dp))
        PullToRefreshBox(isRefreshing = chats.loading && chats.items.isEmpty(), onRefresh = chats::reload, modifier = Modifier.fillMaxSize()) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = TabBarSpace)) {
                if (chats.error.isNotEmpty()) item { Text(chats.error, color = Danger, modifier = Modifier.padding(20.dp, 8.dp)) }
                if (chats.items.isEmpty() && !chats.loading && chats.error.isEmpty()) item {
                    Text("Диалогов пока нет. Откройте чей-нибудь профиль и нажмите «Написать».", color = Muted, modifier = Modifier.padding(20.dp, 32.dp))
                }
                items(chats.items, key = { (if (it.optBoolean("room")) "r:" else "u:") + it.optString("id") }) { chat ->
                    val room = chat.optBoolean("room")
                    Row(
                        Modifier.fillMaxWidth()
                            .clickable { model.open(Screen.Chat(chat.optString("id"), chat.optString("name"), chat.optString("avatar"), room)) }
                            .padding(20.dp, 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Avatar(model.api, chat.optString("avatar"), chat.optString("name"), 52.dp)
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                DisplayName(chat, fontSize = 16.sp, modifier = Modifier.weight(1f))
                                chat.optLong("lastTime").takeIf { it > 0 }?.let { Text(relativeTime(it), color = Muted, fontSize = 12.sp) }
                            }
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(chat.optString("lastText"), color = Muted, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                                val unread = chat.optInt("unread")
                                if (unread > 0) Text(
                                    if (unread > 99) "99+" else unread.toString(),
                                    color = Background, fontSize = 12.sp, fontWeight = FontWeight.Medium,
                                    modifier = Modifier.background(Accent, CircleShape).padding(horizontal = 7.dp, vertical = 2.dp),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

/** One conversation. While it is open it asks the server every three seconds, like the site. */
@Composable
fun ChatScreen(model: AppModel, screen: Screen.Chat) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var messages by remember { mutableStateOf(listOf<JSONObject>()) }
    var canSend by remember { mutableStateOf(true) }
    var secret by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var draft by rememberSaveable { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    // The key survives a failed attempt, so a retry can never deliver the message twice.
    var pendingKey by remember { mutableStateOf<String?>(null) }
    val files = remember { mutableStateListOf<JSONObject>() }

    suspend fun load() {
        try {
            if (screen.room) {
                val room = model.api.get("/api/rooms", mapOf("action" to "room", "id" to screen.id))
                secret = room.optString("kind") == "secret"
                canSend = room.optBoolean("canSend", true) && !secret
                val page = room.objects("messages")
                if (page.lastOrNull()?.optString("id") != messages.lastOrNull()?.optString("id")) page.lastOrNull()?.let {
                    runCatching { model.api.post("/api/rooms", JSONObject().put("action", "read").put("id", screen.id).put("through", it.optString("id"))) }
                }
                messages = page
            } else {
                // Reading a dialogue also marks the peer's messages as read on the server.
                messages = model.api.get("/api/social", mapOf("action" to "messages", "peer" to screen.id)).objects("items")
            }
            error = ""
        } catch (failure: ApiException) {
            error = failure.message.orEmpty()
        }
    }
    LaunchedEffect(screen.id) {
        load()
        model.chats.reload()
        while (true) {
            delay(3_000)
            load()
        }
    }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) scope.launch {
            sending = true
            try {
                val file = withContext(Dispatchers.IO) { readPicked(context, uri) }
                    ?: throw ApiException(0, "UNREADABLE", "Не удалось прочитать фото или оно больше 25 МБ.")
                files += model.api.upload(file.bytes, file.name, file.mime, chatPeer = screen.id)
                error = ""
            } catch (failure: ApiException) { error = failure.message.orEmpty() }
            sending = false
        }
    }
    fun send() {
        val key = pendingKey ?: UUID.randomUUID().toString().also { pendingKey = it }
        sending = true
        scope.launch {
            try {
                val body = JSONObject().put("id", screen.id).put("text", draft.trim()).put("key", key)
                val result = if (screen.room) model.api.post("/api/rooms", body.put("action", "send"))
                else model.api.post("/api/social", body.put("action", "message").put("attachments", JSONArray(files.map { it.optString("id") })))
                draft = ""
                files.clear()
                pendingKey = null
                error = if (result.optBoolean("queued")) "Сообщение отправлено на проверку и появится после одобрения." else ""
                load()
            } catch (failure: ApiException) {
                error = failure.message.orEmpty()
                // A refusal will not change on retry; only a lost connection keeps the key.
                if (failure.status in 400..499 && failure.status != 408) pendingKey = null
            }
            sending = false
        }
    }

    Column(Modifier.fillMaxSize().imePadding().navigationBarsPadding()) {
        TopBar(screen.name, model::back) {
            Avatar(
                model.api, screen.avatar, screen.name, 36.dp,
                Modifier.padding(end = 12.dp).clickable(enabled = !screen.room) { model.open(Screen.Profile(screen.id)) },
            )
        }
        LazyColumn(
            Modifier.weight(1f).fillMaxWidth(),
            reverseLayout = true,
            contentPadding = PaddingValues(12.dp, 8.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            items(messages.asReversed(), key = { it.optString("id") }) { message -> Bubble(model, message, screen.room) }
            if (messages.isEmpty() && error.isEmpty()) item { Text("Сообщений пока нет.", color = Muted, modifier = Modifier.fillMaxWidth().padding(24.dp)) }
        }
        if (error.isNotEmpty()) Text(error, color = Danger, fontSize = 13.sp, modifier = Modifier.padding(16.dp, 4.dp))
        if (secret) Text("Секретные чаты зашифрованы на устройствах и пока открываются только на сайте.", color = Muted, fontSize = 13.sp, modifier = Modifier.padding(16.dp, 8.dp))
        if (files.isNotEmpty()) Row(Modifier.padding(12.dp, 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (file in files) Box {
                NetImage(model.api, "/api/media/" + file.optString("id"), Modifier.size(64.dp).clip(RoundedCornerShape(12.dp)), maxSide = 256)
                Text(
                    "×", color = Foreground,
                    modifier = Modifier.align(Alignment.TopEnd).padding(3.dp).clip(CircleShape).background(Background.copy(alpha = 0.7f))
                        .clickable {
                            files.remove(file)
                            // An unsent upload is returned to the server, as the site does.
                            scope.launch { runCatching { model.api.delete("/api/chat-upload", JSONObject().put("id", file.optString("id"))) } }
                        }.padding(horizontal = 6.dp),
                )
            }
        }
        if (canSend) Row(
            Modifier.fillMaxWidth().background(Card).padding(8.dp, 8.dp, 12.dp, 8.dp),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            if (!screen.room) Icon(
                Glyphs.Photo, "Прикрепить фото", tint = Body,
                modifier = Modifier.padding(bottom = 4.dp).size(48.dp).clip(CircleShape)
                    .clickable(enabled = !sending && files.size < 10) { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }
                    .padding(12.dp),
            )
            OutlinedTextField(
                draft, { draft = it.take(4000); pendingKey = null },
                placeholder = { Text("Сообщение", color = Muted) },
                maxLines = 6,
                shape = RoundedCornerShape(22.dp),
                modifier = Modifier.weight(1f),
            )
            val ready = !sending && (draft.isNotBlank() || files.isNotEmpty())
            Icon(
                Icons.AutoMirrored.Filled.Send, "Отправить", tint = if (ready) Background else Muted,
                modifier = Modifier.padding(bottom = 4.dp).size(48.dp).clip(CircleShape).background(if (ready) Foreground else Segment)
                    .clickable(enabled = ready) { send() }.padding(12.dp),
            )
        }
    }
}

@Composable
private fun Bubble(model: AppModel, message: JSONObject, room: Boolean) {
    val mine = message.optString("sender") == model.myId
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
        Column(
            Modifier.widthIn(max = 300.dp).clip(RoundedCornerShape(18.dp)).background(if (mine) Segment else Color121).padding(12.dp, 8.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            if (room && !mine) Text(message.optString("senderName"), color = Accent, fontSize = 13.sp, fontWeight = FontWeight.Medium)
            message.optJSONObject("reply")?.let {
                Text("↪ ${it.optString("name")}: ${it.optString("text")}", color = Muted, fontSize = 13.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            for (file in message.objects("attachments")) {
                if (file.optString("kind") == "image")
                    NetImage(model.api, "/api/media/" + file.optString("id"), Modifier.fillMaxWidth().heightIn(max = 260.dp).clip(RoundedCornerShape(12.dp)), contentScale = ContentScale.FillWidth)
                else Text("Файл: " + file.optString("name"), color = Body, fontSize = 14.sp)
            }
            val text = message.optString("text")
            when {
                text.isNotEmpty() -> Text(text, color = Foreground, lineHeight = 21.sp)
                !message.isNull("ciphertext") && message.optString("ciphertext").isNotEmpty() -> Text("Зашифрованное сообщение", color = Muted)
            }
            Row(Modifier.align(Alignment.End), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                if (message.optLong("editedAt") > 0) Text("изм.", color = Muted, fontSize = 11.sp)
                Text(clockTime(message.optLong("created")), color = Muted, fontSize = 11.sp)
                // Real read marks from the server, only in personal dialogues.
                if (mine && !room) Text(if (message.optInt("read") != 0) "✓✓" else "✓", color = if (message.optInt("read") != 0) Accent else Muted, fontSize = 11.sp)
            }
        }
    }
}

private val Color121 = androidx.compose.ui.graphics.Color(0xFF121212)
