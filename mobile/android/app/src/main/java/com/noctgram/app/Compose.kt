package com.noctgram.app

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/** A toggle in the composer's tool row: «Код», «Фото», «Опрос», «18+». */
@Composable
private fun Tool(icon: ImageVector, label: String, active: Boolean, onClick: () -> Unit) = Row(
    Modifier.clip(RoundedCornerShape(50)).background(if (active) Accent.copy(alpha = 0.18f) else Segment).clickable(onClick = onClick).padding(12.dp, 8.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(6.dp),
) {
    Icon(icon, contentDescription = null, tint = if (active) Accent else Body, modifier = Modifier.size(18.dp))
    Text(label, color = if (active) Accent else Body, fontSize = 13.sp)
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
            PrimaryButton(if (busy) "Публикуем…" else "Опубликовать", enabled = ready, modifier = Modifier.padding(end = 12.dp), onClick = ::publish)
        }
        Column(
            Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            OutlinedTextField(
                text, { text = it.take(5000) },
                placeholder = { Text("Что нового?", color = Muted) },
                textStyle = TextStyle(fontSize = 17.sp, color = Foreground),
                minLines = 4,
                modifier = Modifier.fillMaxWidth(),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Tool(Glyphs.Photo, "Фото ${photos.size}/4", photos.isNotEmpty()) {
                    if (photos.size < 4) picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                }
                Tool(Glyphs.Code, "Код", codeOn) { codeOn = !codeOn }
                Tool(Glyphs.Poll, "Опрос", pollOn) { pollOn = !pollOn }
                if (photos.isNotEmpty()) Tool(Icons.Default.Warning, "18+", adult) { adult = !adult }
            }
            if (photos.isNotEmpty()) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (photo in photos) Box(Modifier.size(76.dp)) {
                    val preview = remember(photo) {
                        android.graphics.BitmapFactory.decodeByteArray(
                            photo.bytes, 0, photo.bytes.size,
                            android.graphics.BitmapFactory.Options().apply { inSampleSize = 8 },
                        )?.asImageBitmap()
                    }
                    if (preview != null) Image(preview, null, Modifier.fillMaxSize().clip(RoundedCornerShape(12.dp)), contentScale = ContentScale.Crop)
                    else Box(Modifier.fillMaxSize().clip(RoundedCornerShape(12.dp)).background(Segment))
                    Icon(
                        Icons.Default.Close, "Убрать фото", tint = Foreground,
                        modifier = Modifier.align(Alignment.TopEnd).padding(4.dp).size(22.dp).clip(CircleShape)
                            .background(Background.copy(alpha = 0.7f)).clickable { photos.remove(photo) }.padding(3.dp),
                    )
                }
            }
            if (codeOn) {
                OutlinedTextField(language, { language = it.take(24) }, label = { Text("Язык") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(
                    code, { code = it.take(20_000) },
                    label = { Text("Блок кода") },
                    textStyle = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 13.sp, color = Foreground),
                    minLines = 5,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            if (pollOn) {
                options.forEachIndexed { index, value ->
                    OutlinedTextField(
                        value, { options[index] = it.take(100) },
                        label = { Text("Ответ ${index + 1}") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                if (options.size < 6) Text("Добавить ответ", color = Accent, modifier = Modifier.clip(RoundedCornerShape(50)).clickable { options += "" }.padding(8.dp))
                Text("От двух до шести ответов. Пустые строки не публикуются.", color = Muted, fontSize = 13.sp)
            }
            if (error.isNotEmpty()) Text(error, color = Danger)
        }
    }
}

/** Replies under a publication: the latest page first, older ones on demand, and a field to answer. */
@Composable
fun CommentsScreen(model: AppModel, post: JSONObject) {
    val scope = rememberCoroutineScope()
    var comments by remember { mutableStateOf(listOf<JSONObject>()) }
    var older by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf("") }
    var draft by rememberSaveable { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    val id = post.optString("id")

    suspend fun load(before: JSONObject?) {
        try {
            val query = buildMap {
                put("action", "comments")
                put("post", id)
                before?.let { put("before", it.optLong("created").toString()); put("beforeId", it.optString("id")) }
            }
            val page = model.api.get("/api/social", query).objects("items").sortedBy { it.optLong("created") }
            comments = if (before == null) page else page + comments
            older = page.size >= 50
            error = ""
        } catch (failure: ApiException) { error = failure.message.orEmpty() }
        loading = false
    }
    LaunchedEffect(id) { load(null) }

    Column(Modifier.fillMaxSize().imePadding().navigationBarsPadding()) {
        TopBar("Комментарии", model::back)
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            item { PostCard(model, null, post) }
            if (older) item {
                Text("Показать предыдущие", color = Accent, modifier = Modifier.clip(RoundedCornerShape(50)).clickable { scope.launch { load(comments.firstOrNull()) } }.padding(8.dp))
            }
            if (error.isNotEmpty()) item { Text(error, color = Danger) }
            if (!loading && comments.isEmpty() && error.isEmpty()) item { Text("Пока никто не ответил. Будьте первым.", color = Muted) }
            items(comments, key = { it.optString("id") }) { comment ->
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Avatar(model.api, comment.optString("avatar"), comment.optString("name"), 36.dp, Modifier.clickable { model.open(Screen.Profile(comment.optString("userId"))) })
                    Column(Modifier.weight(1f)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            DisplayName(comment, modifier = Modifier.weight(1f, fill = false))
                            Text(relativeTime(comment.optLong("created")), color = Muted, fontSize = 12.sp)
                        }
                        Text(comment.optString("text"), color = Body, lineHeight = 22.sp)
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth().background(Card).padding(12.dp, 8.dp), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                draft, { draft = it.take(2000) },
                placeholder = { Text("Ваш ответ", color = Muted) },
                maxLines = 5,
                shape = RoundedCornerShape(22.dp),
                modifier = Modifier.weight(1f),
            )
            val ready = draft.isNotBlank() && !sending
            Icon(
                Icons.AutoMirrored.Filled.Send, "Отправить", tint = if (ready) Background else Muted,
                modifier = Modifier.padding(bottom = 4.dp).size(48.dp).clip(CircleShape).background(if (ready) Foreground else Segment)
                    .clickable(enabled = ready) {
                        sending = true
                        scope.launch {
                            try {
                                val result = model.api.post("/api/social", JSONObject().put("action", "comment").put("id", id).put("text", draft.trim()))
                                draft = ""
                                // Held for moderation: the server says so instead of returning the reply.
                                error = if (result.optBoolean("queued")) result.optString("notice", "Ответ отправлен на проверку.") else ""
                                load(null)
                            } catch (failure: ApiException) { error = failure.message.orEmpty() }
                            sending = false
                        }
                    }.padding(12.dp),
            )
        }
    }
}
