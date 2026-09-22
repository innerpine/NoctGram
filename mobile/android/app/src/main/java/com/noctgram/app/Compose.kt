package com.noctgram.app

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/** A tool of the editor's bottom row: lit while its block is open. */
@Composable
private fun Tool(icon: ImageVector, label: String, active: Boolean, enabled: Boolean = true, onClick: () -> Unit) = IconAction(
    icon, label,
    tint = if (active) Foreground else Secondary,
    background = if (active) Fill10 else Color.Transparent,
    size = 40.dp, iconSize = 20.dp, enabled = enabled, onClick = onClick,
)

/** A titled block of the editor (code, poll) with a button that removes it. */
@Composable
private fun EditorBlock(icon: ImageVector, title: String, onClose: () -> Unit, content: @Composable () -> Unit) = Column(
    Modifier.fillMaxWidth().noctCard(RoundedCornerShape(14.dp)),
) {
    Row(Modifier.fillMaxWidth().padding(start = 14.dp, end = 4.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, tint = Secondary, modifier = Modifier.size(16.dp))
        Text(title, fontSize = 14.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(start = 8.dp).weight(1f))
        IconAction(Lucide.X, "Убрать: $title", size = 36.dp, iconSize = 16.dp, onClick = onClose)
    }
    HairlineDivider()
    Box(Modifier.padding(14.dp)) { content() }
}

/** A new publication: text, a code block, up to four photos, a poll and the 18+ mark — the site's limits. */
@Composable
fun ComposerScreen(model: AppModel) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var text by rememberSaveable { mutableStateOf("") }
    var codeOn by rememberSaveable { mutableStateOf(false) }
    var code by rememberSaveable { mutableStateOf("") }
    var language by rememberSaveable { mutableStateOf("") }
    var pollOn by rememberSaveable { mutableStateOf(false) }
    val options = remember { mutableStateListOf("", "") }
    val photos = remember { mutableStateListOf<PickedFile>() }
    var adult by rememberSaveable { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(4)) { uris ->
        scope.launch {
            val picked = withContext(Dispatchers.IO) { uris.map { readPicked(context, it) } }
            if (picked.any { it == null }) error = "Некоторые фото не удалось прочитать или они больше 25 МБ."
            photos += picked.filterNotNull().take(4 - photos.size)
        }
    }
    val poll = options.map { it.trim() }.filter { it.isNotEmpty() }
    val ready = !busy && (text.isNotBlank() || photos.isNotEmpty() || (codeOn && code.isNotBlank()) || (pollOn && poll.size >= 2)) &&
        (!pollOn || poll.size >= 2)

    fun publish() {
        busy = true
        error = ""
        scope.launch {
            try {
                val media = JSONArray()
                for (photo in photos) media.put(model.api.upload(photo.bytes, photo.name, photo.mime).getString("id"))
                val body = JSONObject().put("action", "post").put("text", text.trim()).put("media", media).put("adult", adult && photos.isNotEmpty())
                if (codeOn && code.isNotBlank()) body.put("code", code).put("codeLang", language.trim().ifEmpty { "text" })
                if (pollOn) body.put("poll", JSONArray(poll))
                model.api.post("/api/social", body)
                model.updated()
                model.back()
            } catch (failure: ApiException) {
                error = failure.message.orEmpty() + " Если отправка прервалась, проверьте ленту перед повтором."
                busy = false
            }
        }
    }

    Column(Modifier.fillMaxSize().imePadding().navigationBarsPadding()) {
        TopBar("Новая публикация", model::back) {
            NoctButton(if (busy) "Публикуем…" else "Опубликовать", ::publish, enabled = ready, compact = true)
        }
        Column(
            Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            model.me?.let { me ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Avatar(model.api, me.optString("avatar"), me.optString("name"), 40.dp)
                    Column {
                        DisplayName(me)
                        Text("Публикация в ленте", color = Muted, fontSize = 13.sp)
                    }
                }
            }
            BasicTextField(
                text, { text = it.take(5000) },
                textStyle = TextStyle(fontFamily = Inter, fontSize = 17.sp, lineHeight = 25.sp, color = Foreground),
                cursorBrush = SolidColor(Accent),
                modifier = Modifier.fillMaxWidth().heightIn(min = 120.dp),
                decorationBox = { field ->
                    Box {
                        if (text.isEmpty()) Text("Что нового?", color = Muted, fontSize = 17.sp, lineHeight = 25.sp)
                        field()
                    }
                },
            )
            if (photos.isNotEmpty()) Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (photo in photos) Box(Modifier.size(96.dp)) {
                    val preview = remember(photo) {
                        android.graphics.BitmapFactory.decodeByteArray(
                            photo.bytes, 0, photo.bytes.size,
                            android.graphics.BitmapFactory.Options().apply { inSampleSize = 8 },
                        )?.asImageBitmap()
                    }
                    if (preview != null) Image(preview, null, Modifier.fillMaxSize().clip(RoundedCornerShape(14.dp)), contentScale = ContentScale.Crop)
                    else Box(Modifier.fillMaxSize().clip(RoundedCornerShape(14.dp)).background(Cover))
                    IconAction(
                        Lucide.X, "Убрать фото", tint = Foreground, size = 26.dp, iconSize = 14.dp, background = Background.copy(alpha = 0.75f),
                        modifier = Modifier.align(Alignment.TopEnd).padding(4.dp),
                    ) { photos.remove(photo) }
                }
            }
            if (photos.isNotEmpty()) Row(
                Modifier.fillMaxWidth().noctCard(RoundedCornerShape(14.dp)).padding(start = 14.dp, end = 8.dp, top = 4.dp, bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Icon(Lucide.EyeOff, contentDescription = null, tint = Secondary, modifier = Modifier.size(17.dp))
                Column(Modifier.weight(1f)) {
                    Text("Материал 18+", fontSize = 14.sp, fontWeight = FontWeight.Medium)
                    Text("Фото будут скрыты, пока читатель не нажмёт", color = Muted, fontSize = 12.sp)
                }
                Switch(adult, { adult = it }, colors = noctSwitchColors())
            }
            if (codeOn) EditorBlock(Lucide.Code, "Блок кода", onClose = { codeOn = false }) {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    NoctField(language, { language = it.take(24) }, placeholder = "Язык, например kotlin", singleLine = true)
                    NoctField(
                        code, { code = it.take(20_000) },
                        placeholder = "Вставьте код",
                        minLines = 5,
                        textStyle = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 13.sp, lineHeight = 20.sp),
                    )
                }
            }
            if (pollOn) EditorBlock(Lucide.Poll, "Опрос", onClose = { pollOn = false }) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    options.forEachIndexed { index, value ->
                        NoctField(value, { options[index] = it.take(100) }, placeholder = "Ответ ${index + 1}", singleLine = true)
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (options.size < 6) NoctButton("Добавить ответ", { options += "" }, tone = Tone.Quiet, icon = Lucide.Plus, compact = true)
                        Spacer(Modifier.weight(1f))
                        Text("${options.size} из 6", color = Muted, fontSize = 12.sp)
                    }
                }
            }
            if (error.isNotEmpty()) ErrorNote(error)
        }
        HairlineDivider()
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Tool(Lucide.Image, "Фото", photos.isNotEmpty(), enabled = photos.size < 4) {
                picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
            }
            Tool(Lucide.Code, "Код", codeOn) { codeOn = !codeOn }
            Tool(Lucide.Poll, "Опрос", pollOn) { pollOn = !pollOn }
            Spacer(Modifier.weight(1f))
            if (photos.isNotEmpty()) Text("фото ${photos.size}/4 · ", color = Muted, fontSize = 12.sp)
            Text("${text.length}/5000", color = if (text.length > 4800) Gold else Muted, fontSize = 12.sp, modifier = Modifier.padding(end = 8.dp))
        }
    }
}

@Composable
fun noctSwitchColors() = androidx.compose.material3.SwitchDefaults.colors(
    checkedThumbColor = Background,
    checkedTrackColor = Foreground,
    checkedBorderColor = Foreground,
    uncheckedThumbColor = Secondary,
    uncheckedTrackColor = Fill6,
    uncheckedBorderColor = Border,
)

/** What the comments screen shows. */
class CommentsState {
    var comments by mutableStateOf(listOf<JSONObject>())
    var older by mutableStateOf(false)
    var loading by mutableStateOf(true)
    var error by mutableStateOf("")
    var sending by mutableStateOf(false)
}

/** Replies under a publication: the latest page first, older ones on demand, and a field to answer. */
@Composable
fun CommentsScreen(model: AppModel, post: JSONObject) {
    val scope = rememberCoroutineScope()
    val state = remember { CommentsState() }
    var draft by rememberSaveable { mutableStateOf("") }
    val id = post.optString("id")
    val live = !LocalInspectionMode.current

    suspend fun load(before: JSONObject?) {
        try {
            val query = buildMap {
                put("action", "comments")
                put("post", id)
                before?.let { put("before", it.optLong("created").toString()); put("beforeId", it.optString("id")) }
            }
            val page = model.api.get("/api/social", query).objects("items").sortedBy { it.optLong("created") }
            state.comments = if (before == null) page else page + state.comments
            state.older = page.size >= 50
            state.error = ""
        } catch (failure: ApiException) { state.error = failure.message.orEmpty() }
        state.loading = false
    }
    LaunchedEffect(id) { if (live) load(null) }
    CommentsContent(
        model, post, state, draft,
        onDraft = { draft = it.take(2000) },
        onOlder = { scope.launch { load(state.comments.firstOrNull()) } },
        onSend = {
            state.sending = true
            scope.launch {
                try {
                    val result = model.api.post("/api/social", JSONObject().put("action", "comment").put("id", id).put("text", draft.trim()))
                    draft = ""
                    // Held for moderation: the server says so instead of returning the reply.
                    state.error = if (result.optBoolean("queued")) result.optString("notice", "Ответ отправлен на проверку.") else ""
                    load(null)
                } catch (failure: ApiException) { state.error = failure.message.orEmpty() }
                state.sending = false
            }
        },
    )
}

@Composable
internal fun CommentsContent(
    model: AppModel,
    post: JSONObject,
    state: CommentsState,
    draft: String,
    onDraft: (String) -> Unit,
    onOlder: () -> Unit,
    onSend: () -> Unit,
) = Column(Modifier.fillMaxSize().imePadding().navigationBarsPadding()) {
    val count = maxOf(post.optLong("comments"), state.comments.size.toLong())
    TopBar("Комментарии", model::back, subtitle = if (count > 0) "${groupedNumber(count)} ${plural(count, "ответ", "ответа", "ответов")}" else null)
    LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        item(key = "post") { PostCard(model, null, post) }
        item(key = "gap") { Spacer(Modifier.size(8.dp)) }
        if (state.older) item(key = "older") {
            NoctButton("Показать предыдущие", onOlder, tone = Tone.Quiet, compact = true)
        }
        if (state.error.isNotEmpty()) item(key = "error") { ErrorNote(state.error) }
        if (state.loading) items(3, key = { "skeleton$it" }) {
            Row(Modifier.padding(horizontal = 4.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(Modifier.size(36.dp).skeleton(CircleShape))
                Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                    Box(Modifier.size(width = 120.dp, height = 12.dp).skeleton())
                    Box(Modifier.size(width = 220.dp, height = 12.dp).skeleton())
                }
            }
        }
        if (!state.loading && state.comments.isEmpty() && state.error.isEmpty()) item(key = "empty") {
            EmptyState(Lucide.MessageCircle, "Пока никто не ответил", "Будьте первым.")
        }
        items(state.comments, key = { it.optString("id") }) { comment -> Comment(model, comment) }
    }
    HairlineDivider()
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.Bottom,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        MessageField(draft, onDraft, placeholder = "Ваш ответ…", modifier = Modifier.weight(1f))
        SendButton(draft.isNotBlank() && !state.sending, onSend)
    }
}

@Composable
private fun Comment(model: AppModel, comment: JSONObject) = Row(
    Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 10.dp),
    horizontalArrangement = Arrangement.spacedBy(12.dp),
) {
    val author = { model.open(Screen.Profile(comment.optString("userId"))) }
    Avatar(model.api, comment.optString("avatar"), comment.optString("name"), 36.dp, Modifier.clickable(onClick = author))
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            DisplayName(comment, fontSize = 14.sp, modifier = Modifier.weight(1f, fill = false).clickable(onClick = author))
            Text("· " + relativeTime(comment.optLong("created")), color = Muted, fontSize = 12.sp)
        }
        Text(comment.optString("text"), color = PostText, fontSize = 15.sp, lineHeight = 22.sp)
    }
}
