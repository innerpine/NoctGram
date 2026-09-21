package com.noctgram.app

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
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONObject

/** A profile: the signed-in account in its tab (no back arrow) or anyone else opened on top. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileScreen(model: AppModel, id: String, onBack: (() -> Unit)?) {
    val scope = rememberCoroutineScope()
    val own = id == model.myId
    val feed = remember(id) { FeedState(model.api, scope) }
    val list = rememberLazyListState()
    // The bootstrap record draws the own profile at once; the full one adds counts and the number.
    var profile by remember(id) { mutableStateOf(if (own) model.me else null) }
    var error by remember(id) { mutableStateOf("") }
    val load: () -> Unit = {
        feed.reload(userId = id)
        scope.launch {
            try {
                profile = model.api.get("/api/social", mapOf("action" to "profile", "id" to id))
                error = ""
            } catch (failure: ApiException) { error = failure.message.orEmpty() }
        }
    }
    LaunchedEffect(id, model.revision) { load() }
    val person = profile
    if (person == null) {
        Column(Modifier.fillMaxSize()) {
            if (onBack != null) TopBar("Профиль", onBack)
            if (error.isNotEmpty()) FullScreenError(error, load)
        }
        return
    }
    PullToRefreshBox(isRefreshing = feed.loading, onRefresh = load, modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            Modifier.fillMaxSize(),
            state = list,
            contentPadding = PaddingValues(16.dp, if (onBack == null) 12.dp else 0.dp, 16.dp, if (onBack == null) TabBarSpace else 24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            item {
                Header(model, person, own, onBack, reload = load) { scope.launch { list.animateScrollToItem(1) } }
            }
            if (error.isNotEmpty()) item { Text(error, color = Danger) }
            if (person.optBoolean("blocked")) item { Text("Аккаунт заблокирован. Публикации скрыты.", color = Muted) }
            else posts(model, feed, emptyText = if (own) "Здесь появятся ваши публикации." else "Публикаций пока нет.")
        }
    }
}

@Composable
private fun Header(model: AppModel, person: JSONObject, own: Boolean, onBack: (() -> Unit)?, reload: () -> Unit, toPosts: () -> Unit) {
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    val look = Look(person)
    val avatar = person.optString("avatar")
    val cover = person.optString("cover")
    val id = person.optString("id")
    // Premium accounts may tint the whole card: the site's color-mix() of the chosen colours into #0b0b10.
    val background = runCatching { JSONObject(person.optString("profileBackground")) }.getOrNull()
    val mode = background?.optString("mode").orEmpty()
    val surface = if (look.premium && mode.isNotEmpty() && mode != "none") {
        val intensity = background!!.optInt("intensity", 30)
        // ponytail: «по обложке» uses the theme colours here; sample the cover bitmap when it matters.
        val (first, second) = if (mode == "custom") parseColor(background.optString("first")) to parseColor(background.optString("second")) else look.first to look.second
        Brush.linearGradient(listOf(washed(first, intensity), washed(second, intensity)))
    } else Brush.linearGradient(listOf(Card, Card))
    val shape = RoundedCornerShape(20.dp)
    Column(Modifier.fillMaxWidth().then(if (onBack != null) Modifier.statusBarsPadding() else Modifier).clip(shape).background(surface).border(1.dp, if (look.active) look.first.copy(alpha = 0.25f) else Hairline, shape)) {
        Box(Modifier.fillMaxWidth().height(150.dp).background(if (look.active) Brush.linearGradient(listOf(washed(look.first, 45), washed(look.second, 25))) else Brush.linearGradient(listOf(Segment, Card)))) {
            when {
                // ponytail: «Жидкое» is a still, blurred avatar here (blur needs Android 12+).
                // Animate it with an AGSL RuntimeShader (Android 13+) when the banner matters in the app.
                cover == "liquid" && avatar.isNotEmpty() -> NetImage(model.api, avatar, Modifier.fillMaxSize().blur(48.dp), maxSide = 256)
                cover.startsWith("/api/") -> NetImage(model.api, cover, Modifier.fillMaxSize())
                else -> Text("n.", color = Foreground.copy(alpha = 0.06f), fontSize = 120.sp, fontWeight = FontWeight.Medium, modifier = Modifier.align(Alignment.CenterEnd).padding(end = 20.dp))
            }
            if (onBack != null) Icon(
                Icons.AutoMirrored.Filled.ArrowBack, "Назад", tint = Foreground,
                modifier = Modifier.padding(12.dp).size(40.dp).clip(CircleShape).background(Background.copy(alpha = 0.55f)).clickable(onClick = onBack).padding(9.dp),
            )
        }
        Column(Modifier.padding(horizontal = 20.dp).padding(bottom = 20.dp)) {
            Row(verticalAlignment = Alignment.Bottom) {
                Box(Modifier.offset(x = (-6).dp, y = (-44).dp)) { ProfileAvatar(model.api, person, 96.dp) }
                Spacer(Modifier.weight(1f))
                Row(Modifier.padding(bottom = 52.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (own) {
                        SecondaryButton("Дизайн") { model.open(Screen.Design) }
                        PrimaryButton("Изменить") { model.open(Screen.EditProfile) }
                    } else if (!person.optBoolean("blocked")) {
                        if (person.optString("kind") != "channel") SecondaryButton("Написать") {
                            model.open(Screen.Chat(id, person.optString("name"), avatar, room = false))
                        }
                        val followed = person.optInt("followed") != 0
                        val toggle: () -> Unit = {
                            scope.launch {
                                runCatching { model.api.post("/api/social", JSONObject().put("action", "follow").put("id", id).put("value", !followed)) }
                                reload()
                            }
                        }
                        if (followed) SecondaryButton("Вы подписаны", onClick = toggle) else PrimaryButton("Подписаться", onClick = toggle)
                    }
                }
            }
            Column(Modifier.offset(y = (-36).dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                DisplayName(person, fontSize = 27.sp)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        "@" + person.optString("handle"), color = Body,
                        modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable { clipboard.setText(AnnotatedString("@" + person.optString("handle"))) },
                    )
                    Presence(person.optLong("lastSeen"))
                }
                val aliases = person.optJSONArray("handles")
                    ?.let { all -> (0 until all.length()).map(all::optString) }
                    ?.filter { it != person.optString("handle") }.orEmpty()
                if (aliases.isNotEmpty()) Labelled("а также", aliases.joinToString(", ") { "@$it" }, look.accent)
                person.optString("anonymousNumber").takeIf { it.length == 8 }?.let {
                    Labelled("Анонимный номер", "+888 ${it.take(4)} ${it.drop(4)}", look.accent)
                }
                person.optString("bio").takeIf { it.isNotBlank() }?.let { Text(it, color = Body, lineHeight = 22.sp, modifier = Modifier.padding(top = 8.dp)) }
                person.optLong("created").takeIf { it > 0 }?.let {
                    Text("В Noctgram с " + java.text.SimpleDateFormat("LLLL yyyy", java.util.Locale("ru")).format(java.util.Date(it)), color = Muted, fontSize = 13.sp)
                }
            }
            Row(
                Modifier.fillMaxWidth().offset(y = (-16).dp).clip(RoundedCornerShape(16.dp)).background(Background.copy(alpha = 0.35f)).border(1.dp, Hairline, RoundedCornerShape(16.dp)),
            ) {
                Stat(person.optLong("followers"), "подписчиков") { model.open(Screen.Connections(id, followers = true)) }
                Box(Modifier.width(1.dp).height(56.dp).background(Hairline))
                Stat(person.optLong("following"), "подписок") { model.open(Screen.Connections(id, followers = false)) }
                Box(Modifier.width(1.dp).height(56.dp).background(Hairline))
                Stat(person.optLong("postCount"), "публикаций", toPosts)
            }
        }
    }
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.Stat(value: Long, label: String, onClick: () -> Unit) = Column(
    Modifier.weight(1f).clickable(onClick = onClick).padding(vertical = 10.dp),
    horizontalAlignment = Alignment.CenterHorizontally,
) {
    Text(groupedNumber(value), fontSize = 17.sp, fontWeight = FontWeight.Medium)
    Text(label, color = Muted, fontSize = 12.sp)
}

@Composable
private fun Labelled(label: String, value: String, color: Color) = Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
    Text(label, color = Muted, fontSize = 13.sp)
    Text(value, color = color, fontSize = 13.sp, fontWeight = FontWeight.Medium)
}

@Composable
private fun Presence(lastSeen: Long) {
    if (lastSeen <= 0) return
    val online = System.currentTimeMillis() - lastSeen < 120_000
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        if (online) Box(Modifier.size(7.dp).background(Green, CircleShape))
        Text(if (online) "В сети" else "был(а) ${relativeTime(lastSeen)} назад", color = if (online) Body else Muted, fontSize = 13.sp)
    }
}

private fun parseColor(hex: String): Color =
    runCatching { Color(android.graphics.Color.parseColor(hex)) }.getOrDefault(Color(0xFF9775CF))

/** Followers or subscriptions of an account, thirty at a time. */
@Composable
fun ConnectionsScreen(model: AppModel, screen: Screen.Connections) {
    var people by remember { mutableStateOf(listOf<JSONObject>()) }
    var cursor by remember { mutableStateOf<String?>("") }
    var error by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    suspend fun more() {
        val after = cursor ?: return
        try {
            val page = model.api.get(
                "/api/social",
                mapOf("action" to "connections", "id" to screen.id, "kind" to if (screen.followers) "followers" else "following", "after" to after),
            )
            people = people + page.objects("people")
            cursor = page.optString("nextCursor").takeIf { page.optBoolean("hasMore") && it.isNotEmpty() }
            error = ""
        } catch (failure: ApiException) {
            error = failure.message.orEmpty()
            cursor = null
        }
    }
    LaunchedEffect(screen) { more() }
    Column(Modifier.fillMaxSize()) {
        TopBar(if (screen.followers) "Подписчики" else "Подписки", model::back)
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
            if (error.isNotEmpty()) item { Text(error, color = Danger, modifier = Modifier.padding(16.dp)) }
            if (people.isEmpty() && cursor == null && error.isEmpty())
                item { Text(if (screen.followers) "Пока никто не подписан." else "Подписок пока нет.", color = Muted, modifier = Modifier.padding(16.dp, 32.dp)) }
            items(people, key = { it.optString("id") }) { person ->
                PersonRow(model.api, person, onClick = { model.open(Screen.Profile(person.optString("id"))) })
            }
            if (cursor != null && people.isNotEmpty()) item {
                LaunchedEffect(people.size) { scope.launch { more() } }
                Text("Загружаем…", color = Muted, modifier = Modifier.padding(16.dp))
            }
        }
    }
}
