package com.noctgram.app

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode
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
import java.util.Calendar
import java.util.UUID

/** Personal dialogues and groups in one list, newest first. Also feeds the tab bar's unread badge. */
class ChatList(private val api: NoctApi, private val scope: CoroutineScope) {
    var items by mutableStateOf(listOf<JSONObject>())
        private set
    var loading by mutableStateOf(false)
        private set
    /** True once the first answer (or failure) arrived, so an empty list is really empty. */
    var loaded by mutableStateOf(false)
        private set
    var error by mutableStateOf("")
        private set
    val unread get() = items.sumOf { it.optInt("unread") }

    /** Screenshot tests: these conversations, as if they had just arrived. */
    internal fun show(chats: List<JSONObject>) {
        items = chats
        loaded = true
    }

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
            loaded = true
        }
    }

    fun clear() {
        items = emptyList()
        error = ""
        loaded = false
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatListScreen(model: AppModel) {
    val chats = model.chats
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().height(56.dp).padding(start = 18.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Чаты", fontSize = 24.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.6).sp, modifier = Modifier.weight(1f))
            if (chats.unread > 0) Text(
                "${groupedNumber(chats.unread.toLong())} ${plural(chats.unread.toLong(), "новое", "новых", "новых")}",
                color = Secondary, fontSize = 13.sp, modifier = Modifier.padding(end = 10.dp),
            )
        }
        PullToRefreshBox(isRefreshing = chats.loading && chats.items.isNotEmpty(), onRefresh = chats::reload, modifier = Modifier.fillMaxSize()) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = 2.dp, bottom = TabBarSpace)) {
                if (chats.error.isNotEmpty()) item { ErrorNote(chats.error, Modifier.padding(horizontal = 12.dp, vertical = 6.dp), onRetry = chats::reload) }
                if (!chats.loaded) items(7) { ChatRowSkeleton() }
                if (chats.loaded && chats.items.isEmpty() && chats.error.isEmpty()) item {
                    EmptyState(Lucide.MessageCircle, "Диалогов пока нет", "Откройте чей-нибудь профиль и нажмите «Написать». Группы тоже появятся здесь.")
                }
                items(chats.items, key = { (if (it.optBoolean("room")) "r:" else "u:") + it.optString("id") }) { chat ->
                    ChatRow(model, chat)
                }
            }
        }
    }
}

@Composable
private fun ChatRow(model: AppModel, chat: JSONObject) {
    val room = chat.optBoolean("room")
    val secret = room && chat.optString("kind") == "secret"
    val unread = chat.optInt("unread")
    Row(
        Modifier.fillMaxWidth()
            .clickable { model.open(Screen.Chat(chat.optString("id"), chat.optString("name"), chat.optString("avatar"), room)) }
            .padding(start = 16.dp, end = 16.dp, top = 9.dp, bottom = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box {
            Avatar(model.api, chat.optString("avatar"), chat.optString("name"), 54.dp)
            if (room) Box(
                Modifier.align(Alignment.BottomEnd).size(20.dp).clip(CircleShape).background(Segment).border(2.dp, Background, CircleShape),
                contentAlignment = Alignment.Center,
            ) { Icon(if (secret) Lucide.Lock else Lucide.Users, contentDescription = null, tint = if (secret) Green else Body, modifier = Modifier.size(11.dp)) }
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                DisplayName(chat, fontSize = 15.sp, weight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                chat.optLong("lastTime").takeIf { it > 0 }?.let {
                    Text(listTime(it), color = if (unread > 0) Foreground else Muted, fontSize = 12.sp)
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    chat.optString("lastText").ifBlank { "Вложение" },
                    color = Secondary, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
                )
                if (unread > 0) Text(
                    if (unread > 99) "99+" else unread.toString(),
                    color = Background, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, lineHeight = 14.sp,
                    modifier = Modifier.heightIn(min = 20.dp).clip(CircleShape).background(Foreground).padding(horizontal = 7.dp, vertical = 3.dp),
                )
            }
        }
    }
}

@Composable
private fun ChatRowSkeleton() = Row(
    Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 9.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(12.dp),
) {
    Box(Modifier.size(54.dp).skeleton(CircleShape))
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.width(150.dp).height(13.dp).skeleton())
        Box(Modifier.width(210.dp).height(11.dp).skeleton())
    }
}

/** Today a time, this week a weekday, older a date: how chat lists show the last message. */
private fun listTime(time: Long, now: Long = System.currentTimeMillis()): String {
    val day = 24 * 60 * 60 * 1000L
    return when {
        dayKey(time) == dayKey(now) -> clockTime(time)
        now - time < 6 * day -> java.text.SimpleDateFormat("EE", java.util.Locale("ru")).format(java.util.Date(time))
        else -> java.text.SimpleDateFormat("d MMM", java.util.Locale("ru")).format(java.util.Date(time)).trimEnd('.')
    }
}

private fun dayKey(time: Long): Int = Calendar.getInstance().run {
    timeInMillis = time
    get(Calendar.YEAR) * 1000 + get(Calendar.DAY_OF_YEAR)
}

private fun dayLabel(time: Long, now: Long = System.currentTimeMillis()): String = when (dayKey(time)) {
    dayKey(now) -> "Сегодня"
    dayKey(now - 24 * 60 * 60 * 1000L) -> "Вчера"
    else -> {
        val sameYear = Calendar.getInstance().apply { timeInMillis = time }.get(Calendar.YEAR) == Calendar.getInstance().get(Calendar.YEAR)
        java.text.SimpleDateFormat(if (sameYear) "d MMMM" else "d MMMM yyyy", java.util.Locale("ru")).format(java.util.Date(time))
    }
}

/** What an open conversation shows and is sending. */
class ChatState {
    var messages by mutableStateOf(listOf<JSONObject>())
    var canSend by mutableStateOf(true)
    var secret by mutableStateOf(false)
    var members by mutableStateOf(0)
    var error by mutableStateOf("")
    var sending by mutableStateOf(false)
    val files = mutableStateListOf<JSONObject>()
}

/** One conversation. While it is open it asks the server every three seconds, like the site. */
@Composable
fun ChatScreen(model: AppModel, screen: Screen.Chat) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val state = remember { ChatState() }
    var draft by rememberSaveable { mutableStateOf("") }
    // The key survives a failed attempt, so a retry can never deliver the message twice.
    var pendingKey by remember { mutableStateOf<String?>(null) }
    val live = !LocalInspectionMode.current

    suspend fun load() {
        try {
            if (screen.room) {
                val room = model.api.get("/api/rooms", mapOf("action" to "room", "id" to screen.id))
                state.secret = room.optString("kind") == "secret"
                state.canSend = room.optBoolean("canSend", true) && !state.secret
                state.members = room.optInt("memberCount", room.objects("members").size)
                val page = room.objects("messages")
                if (page.lastOrNull()?.optString("id") != state.messages.lastOrNull()?.optString("id")) page.lastOrNull()?.let {
                    runCatching { model.api.post("/api/rooms", JSONObject().put("action", "read").put("id", screen.id).put("through", it.optString("id"))) }
                }
                state.messages = page
            } else {
                // Reading a dialogue also marks the peer's messages as read on the server.
                state.messages = model.api.get("/api/social", mapOf("action" to "messages", "peer" to screen.id)).objects("items")
            }
            state.error = ""
        } catch (failure: ApiException) {
            state.error = failure.message.orEmpty()
        }
    }
    LaunchedEffect(screen.id) {
        if (!live) return@LaunchedEffect
        load()
        model.chats.reload()
        while (true) {
            delay(3_000)
            load()
        }
    }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) scope.launch {
            state.sending = true
            try {
                val file = withContext(Dispatchers.IO) { readPicked(context, uri) }
                    ?: throw ApiException(0, "UNREADABLE", "Не удалось прочитать фото или оно больше 25 МБ.")
                state.files += model.api.upload(file.bytes, file.name, file.mime, chatPeer = screen.id)
                state.error = ""
            } catch (failure: ApiException) { state.error = failure.message.orEmpty() }
            state.sending = false
        }
    }
    fun send() {
        val key = pendingKey ?: UUID.randomUUID().toString().also { pendingKey = it }
        state.sending = true
        scope.launch {
            try {
                val body = JSONObject().put("id", screen.id).put("text", draft.trim()).put("key", key)
                val result = if (screen.room) model.api.post("/api/rooms", body.put("action", "send"))
                else model.api.post("/api/social", body.put("action", "message").put("attachments", JSONArray(state.files.map { it.optString("id") })))
                draft = ""
                state.files.clear()
                pendingKey = null
                state.error = if (result.optBoolean("queued")) "Сообщение отправлено на проверку и появится после одобрения." else ""
                load()
            } catch (failure: ApiException) {
                state.error = failure.message.orEmpty()
                // A refusal will not change on retry; only a lost connection keeps the key.
                if (failure.status in 400..499 && failure.status != 408) pendingKey = null
            }
            state.sending = false
        }
    }
    ChatContent(
        model, screen, state, draft,
        onDraft = { draft = it.take(4000); pendingKey = null },
        onAttach = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
        onRemove = { file ->
            state.files.remove(file)
            // An unsent upload is returned to the server, as the site does.
            scope.launch { runCatching { model.api.delete("/api/chat-upload", JSONObject().put("id", file.optString("id"))) } }
        },
        onSend = ::send,
    )
}

/** A message with what it needs to be drawn: whether it opens or closes a run of one sender's messages. */
private sealed interface ChatItem {
    val key: String
    class Day(val label: String, override val key: String) : ChatItem
    class Message(val json: JSONObject, val first: Boolean, val last: Boolean) : ChatItem {
        override val key: String = json.optString("id")
    }
}

/** Oldest to newest: a day heading before each new day, runs of one sender within five minutes grouped. */
private fun chatItems(messages: List<JSONObject>): List<ChatItem> {
    val out = ArrayList<ChatItem>()
    messages.forEachIndexed { index, message ->
        val previous = messages.getOrNull(index - 1)
        val next = messages.getOrNull(index + 1)
        val time = message.optLong("created")
        if (previous == null || dayKey(previous.optLong("created")) != dayKey(time)) out += ChatItem.Day(dayLabel(time), "day:" + dayKey(time))
        fun joined(a: JSONObject?, b: JSONObject?) = a != null && b != null &&
            a.optString("sender") == b.optString("sender") &&
            dayKey(a.optLong("created")) == dayKey(b.optLong("created")) &&
            kotlin.math.abs(a.optLong("created") - b.optLong("created")) < 5 * 60_000
        out += ChatItem.Message(message, first = !joined(previous, message), last = !joined(message, next))
    }
    return out
}

@Composable
internal fun ChatContent(
    model: AppModel,
    screen: Screen.Chat,
    state: ChatState,
    draft: String,
    onDraft: (String) -> Unit,
    onAttach: () -> Unit,
    onRemove: (JSONObject) -> Unit,
    onSend: () -> Unit,
) = Column(Modifier.fillMaxSize().imePadding().navigationBarsPadding()) {
    TopBar(
        screen.name,
        model::back,
        subtitle = when {
            screen.room && state.secret -> "секретный чат"
            screen.room && state.members > 0 -> "${groupedNumber(state.members.toLong())} ${plural(state.members.toLong(), "участник", "участника", "участников")}"
            screen.room -> "группа"
            else -> "личные сообщения"
        },
        leading = {
            Avatar(
                model.api, screen.avatar, screen.name, 38.dp,
                Modifier.clickable(enabled = !screen.room) { model.open(Screen.Profile(screen.id)) },
            )
        },
    )
    val items = remember(state.messages) { chatItems(state.messages).asReversed() }
    LazyColumn(
        Modifier.weight(1f).fillMaxWidth(),
        reverseLayout = true,
        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 10.dp),
    ) {
        items(items, key = { it.key }) { item ->
            when (item) {
                is ChatItem.Day -> Box(Modifier.fillMaxWidth().padding(vertical = 10.dp), Alignment.Center) {
                    Text(
                        item.label, color = Secondary, fontSize = 12.sp, fontWeight = FontWeight.Medium,
                        modifier = Modifier.clip(CircleShape).background(Fill6).padding(horizontal = 12.dp, vertical = 5.dp),
                    )
                }
                is ChatItem.Message -> Bubble(model, item, screen.room)
            }
        }
        if (state.messages.isEmpty() && state.error.isEmpty()) item {
            EmptyState(Lucide.MessageCircle, "Сообщений пока нет", if (state.secret) "Секретный чат читается только на сайте." else "Напишите первым.")
        }
    }
    if (state.error.isNotEmpty()) ErrorNote(state.error, Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
    if (state.secret) Row(
        Modifier.fillMaxWidth().padding(10.dp).noctCard(RoundedCornerShape(14.dp)).padding(14.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Lucide.Lock, contentDescription = null, tint = Green, modifier = Modifier.size(18.dp))
        Text("Секретные чаты зашифрованы на устройствах и пока открываются только на сайте.", color = Secondary, fontSize = 13.sp, lineHeight = 18.sp)
    }
    if (state.files.isNotEmpty()) Row(Modifier.padding(horizontal = 12.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        for (file in state.files) Box {
            NetImage(model.api, "/api/media/" + file.optString("id"), Modifier.size(68.dp).clip(RoundedCornerShape(12.dp)), maxSide = 256)
            IconAction(
                Lucide.X, "Убрать фото", tint = Foreground, size = 24.dp, iconSize = 13.dp, background = Background.copy(alpha = 0.75f),
                modifier = Modifier.align(Alignment.TopEnd).padding(3.dp),
            ) { onRemove(file) }
        }
    }
    if (state.canSend) {
        HairlineDivider()
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            MessageField(
                draft, onDraft,
                placeholder = if (screen.room) "Сообщение в группу…" else "Сообщение…",
                modifier = Modifier.weight(1f),
                leading = if (screen.room) null else ({
                    IconAction(Lucide.Paperclip, "Прикрепить фото", enabled = !state.sending && state.files.size < 10, onClick = onAttach)
                }),
            )
            SendButton(!state.sending && (draft.isNotBlank() || state.files.isNotEmpty()), onSend)
        }
    }
}

/** The round white send button; a quiet grey circle until there is something to send. */
@Composable
fun SendButton(ready: Boolean, onClick: () -> Unit) = Box(
    Modifier.size(46.dp).clip(CircleShape).background(if (ready) Foreground else Fill10).clickable(enabled = ready, onClickLabel = "Отправить", onClick = onClick),
    contentAlignment = Alignment.Center,
) { Icon(Lucide.Send, contentDescription = "Отправить", tint = if (ready) Background else Muted, modifier = Modifier.size(20.dp)) }

@Composable
private fun Bubble(model: AppModel, item: ChatItem.Message, room: Boolean) {
    val message = item.json
    val mine = message.optString("sender") == model.myId
    val tail = 6.dp
    val round = 18.dp
    // The sender's side is tight where messages of one run meet and at the bottom, like a tail.
    val shape = RoundedCornerShape(
        topStart = if (!mine && !item.first) tail else round,
        topEnd = if (mine && !item.first) tail else round,
        bottomEnd = if (mine) tail else round,
        bottomStart = if (!mine) tail else round,
    )
    Row(
        Modifier.fillMaxWidth().padding(top = if (item.first) 8.dp else 2.dp),
        horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
    ) {
        Column(
            Modifier.widthIn(max = 300.dp).clip(shape).background(if (mine) Outgoing else Incoming)
                .border(1.dp, if (mine) Color.Transparent else Hairline, shape).padding(horizontal = 12.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            if (room && !mine && item.first) Text(message.optString("senderName"), color = Accent, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            message.optJSONObject("reply")?.let {
                Row(Modifier.clip(RoundedCornerShape(8.dp)).background(Fill6).padding(end = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.width(3.dp).height(36.dp).background(Accent))
                    Column(Modifier.padding(start = 8.dp, top = 4.dp, bottom = 4.dp)) {
                        Text(it.optString("name"), color = Accent, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
                        Text(it.optString("text"), color = Secondary, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
            for (file in message.objects("attachments")) {
                if (file.optString("kind") == "image")
                    NetImage(model.api, "/api/media/" + file.optString("id"), Modifier.fillMaxWidth().heightIn(max = 280.dp).clip(RoundedCornerShape(12.dp)), contentScale = ContentScale.FillWidth)
                else Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Lucide.Paperclip, contentDescription = null, tint = Secondary, modifier = Modifier.size(16.dp))
                    Text(file.optString("name"), color = Body, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            val text = message.optString("text")
            when {
                text.isNotEmpty() -> Text(text, color = Foreground, fontSize = 15.sp, lineHeight = 21.sp)
                !message.isNull("ciphertext") && message.optString("ciphertext").isNotEmpty() ->
                    Text("Зашифрованное сообщение", color = Muted, fontSize = 14.sp)
            }
            Row(Modifier.align(Alignment.End), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                if (message.optLong("editedAt") > 0) Text("изм.", color = Muted, fontSize = 11.sp)
                Text(clockTime(message.optLong("created")), color = Muted, fontSize = 11.sp)
                // Real read marks from the server, only in personal dialogues.
                if (mine && !room) {
                    val read = message.optInt("read") != 0
                    Icon(if (read) Lucide.CheckCheck else Lucide.Check, contentDescription = if (read) "Прочитано" else "Доставлено", tint = if (read) Accent else Muted, modifier = Modifier.size(14.dp))
                }
            }
        }
    }
}
