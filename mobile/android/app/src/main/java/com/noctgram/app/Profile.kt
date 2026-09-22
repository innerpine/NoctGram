package com.noctgram.app

import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONObject

/** A profile: the signed-in account in its tab (no back arrow) or anyone else opened on top. */
@Composable
fun ProfileScreen(model: AppModel, id: String, onBack: (() -> Unit)?) {
    val scope = rememberCoroutineScope()
    val own = id == model.myId
    val feed = remember(id) { FeedState(model.api, scope) }
    // The bootstrap record draws the own profile at once; the full one adds counts and the number.
    var profile by remember(id) { mutableStateOf(if (own) model.me else null) }
    var error by remember(id) { mutableStateOf("") }
    val live = !LocalInspectionMode.current
    val load: () -> Unit = {
        feed.reload(userId = id)
        scope.launch {
            try {
                profile = model.api.get("/api/social", mapOf("action" to "profile", "id" to id))
                error = ""
            } catch (failure: ApiException) { error = failure.message.orEmpty() }
        }
    }
    LaunchedEffect(id, model.revision) { if (live) load() }
    val person = profile
    when {
        person != null -> ProfileContent(model, person, feed, own, onBack, error, load)
        error.isNotEmpty() -> Column(Modifier.fillMaxSize()) {
            if (onBack != null) TopBar("Профиль", onBack)
            FullScreenError(error, load)
        }
        else -> Column(Modifier.fillMaxSize()) {
            if (onBack != null) TopBar("Профиль", onBack)
            ProfileSkeleton()
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ProfileContent(
    model: AppModel,
    person: JSONObject,
    feed: FeedState,
    own: Boolean,
    onBack: (() -> Unit)?,
    error: String,
    reload: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val list = rememberLazyListState()
    // Opened on top, the card starts under the status bar; in its tab the tab host already made room.
    val top = if (onBack != null) WindowInsets.statusBars.asPaddingValues().calculateTopPadding() + 8.dp else 8.dp
    PullToRefreshBox(isRefreshing = feed.loading && feed.posts.isNotEmpty(), onRefresh = reload, modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            Modifier.fillMaxSize(),
            state = list,
            contentPadding = PaddingValues(start = 12.dp, top = top, end = 12.dp, bottom = if (onBack == null) TabBarSpace else 28.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item(key = "header") {
                ProfileHeader(model, person, own, onBack, reload) { scope.launch { list.animateScrollToItem(1) } }
            }
            if (error.isNotEmpty()) item(key = "error") { ErrorNote(error, onRetry = reload) }
            if (person.optBoolean("blocked")) item(key = "blocked") {
                EmptyState(Lucide.Lock, "Профиль недоступен", "Аккаунт заблокирован, публикации скрыты.")
            } else {
                item(key = "posts-title") {
                    Row(Modifier.padding(start = 4.dp, top = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Публикации", fontSize = 17.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.3).sp)
                        person.optLong("postCount").takeIf { it > 0 }?.let { Text(groupedNumber(it), color = Muted, fontSize = 15.sp) }
                    }
                }
                posts(model, feed, empty = if (own) "Здесь появятся ваши публикации." else "Автор ещё ничего не опубликовал.")
            }
        }
    }
}

/** How much wider than the face the decorations make the avatar box: the text ring or the chrome rim. */
private fun decorations(look: Look): Dp = if (look.ringText.isNotBlank()) 44.dp else if (look.chrome) 12.dp else 0.dp

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ProfileHeader(model: AppModel, person: JSONObject, own: Boolean, onBack: (() -> Unit)?, reload: () -> Unit, toPosts: () -> Unit) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val look = Look(person)
    val avatar = person.optString("avatar")
    val cover = person.optString("cover")
    val id = person.optString("id")
    // Premium accounts may tint the whole card: the site's color-mix() of the chosen colours into #0b0b10.
    val background = runCatching { JSONObject(person.optString("profileBackground")) }.getOrNull()
    val mode = background?.optString("mode").orEmpty()
    val tinted = look.premium && mode.isNotEmpty() && mode != "none"
    val surface = if (tinted) {
        val intensity = background!!.optInt("intensity", 30)
        // ponytail: «по обложке» uses the theme colours here; sample the cover bitmap when it matters.
        val (first, second) = if (mode == "custom") parseColor(background.optString("first")) to parseColor(background.optString("second")) else look.first to look.second
        Brush.linearGradient(listOf(washed(first, intensity), washed(second, intensity)))
    } else Brush.linearGradient(listOf(Card, Card))
    val edge = if (tinted) Color(0xFF0B0B10) else Card
    val shape = RoundedCornerShape(20.dp)
    Column(Modifier.fillMaxWidth().clip(shape).background(surface).border(1.dp, if (look.active) look.first.copy(alpha = 0.22f) else Hairline, shape)) {
        Box(
            Modifier.fillMaxWidth().height(156.dp)
                .background(if (look.active) Brush.linearGradient(listOf(washed(look.first, 38), washed(look.second, 20))) else Brush.linearGradient(listOf(Cover, Cover))),
        ) {
            when {
                // ponytail: «Жидкое» is a still, blurred avatar here (blur needs Android 12+).
                // Animate it with an AGSL RuntimeShader (Android 13+) when the banner matters in the app.
                cover == "liquid" && avatar.isNotEmpty() && Build.VERSION.SDK_INT >= 31 ->
                    NetImage(model.api, avatar, Modifier.fillMaxSize().blur(48.dp), maxSide = 256)
                cover.startsWith("/api/") -> NetImage(model.api, cover, Modifier.fillMaxSize())
                cover != "liquid" -> Text(
                    "n.", color = Foreground.copy(alpha = 0.05f), fontFamily = Brand, fontSize = 150.sp, fontWeight = FontWeight.SemiBold,
                    letterSpacing = (-12).sp, modifier = Modifier.align(Alignment.BottomEnd).padding(end = 18.dp).padding(bottom = 0.dp),
                )
            }
            if (onBack != null) IconAction(
                Lucide.ArrowLeft, "Назад", tint = Foreground, size = 38.dp, iconSize = 19.dp,
                background = Background.copy(alpha = 0.55f), modifier = Modifier.padding(10.dp), onClick = onBack,
            )
        }
        Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 18.dp)) {
            val extra = decorations(look)
            Row(Modifier.fillMaxWidth().overlapUp(46.dp + extra / 2), verticalAlignment = Alignment.Bottom) {
                ProfileAvatar(model.api, person, 92.dp, edge)
                Spacer(Modifier.weight(1f))
                Row(Modifier.padding(bottom = 6.dp + extra / 2), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (own) {
                        NoctButton("Редактировать", onClick = { model.open(Screen.EditProfile) }, tone = Tone.Secondary, compact = true)
                        IconAction(Lucide.Palette, "Дизайн профиля", tint = Foreground, size = 34.dp, iconSize = 17.dp, background = Fill6) { model.open(Screen.Design) }
                    } else if (!person.optBoolean("blocked")) {
                        if (person.optString("kind") != "channel") IconAction(Lucide.MessageCircle, "Написать", tint = Foreground, size = 34.dp, iconSize = 17.dp, background = Fill6) {
                            model.open(Screen.Chat(id, person.optString("name"), avatar, room = false))
                        }
                        val followed = person.optInt("followed") != 0
                        val toggle: () -> Unit = {
                            scope.launch {
                                runCatching { model.api.post("/api/social", JSONObject().put("action", "follow").put("id", id).put("value", !followed)) }
                                reload()
                            }
                        }
                        NoctButton(if (followed) "Вы подписаны" else "Подписаться", toggle, tone = if (followed) Tone.Secondary else Tone.Primary, compact = true)
                    }
                }
            }
            Spacer(Modifier.height(12.dp))
            DisplayName(person, fontSize = 27.sp)
            Row(Modifier.padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                val handle = "@" + person.optString("handle")
                Row(
                    Modifier.clip(RoundedCornerShape(8.dp)).clickable { copyText(context, clipboard, handle, "Юзернейм") },
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(5.dp),
                ) {
                    Text(handle, color = if (look.active) look.first else Secondary, fontSize = 15.sp)
                    Icon(Lucide.Copy, contentDescription = "Скопировать", tint = Muted, modifier = Modifier.size(13.dp))
                }
                Presence(person.optLong("lastSeen"))
            }
            val aliases = person.optJSONArray("handles")
                ?.let { all -> (0 until all.length()).map(all::optString) }
                ?.filter { it != person.optString("handle") }.orEmpty()
            Column(Modifier.padding(top = 10.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                if (aliases.isNotEmpty()) Labelled("а также", aliases.joinToString(", ") { "@$it" }, look.accent)
                person.optString("anonymousNumber").takeIf { it.length == 8 }?.let {
                    Labelled("Анонимный номер", "+888 ${it.take(4)} ${it.drop(4)}", look.accent)
                }
            }
            person.optString("bio").takeIf { it.isNotBlank() }?.let {
                Text(it, color = Body, fontSize = 15.sp, lineHeight = 23.sp, modifier = Modifier.padding(top = 12.dp))
            }
            person.optLong("created").takeIf { it > 0 }?.let {
                Row(Modifier.padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    Icon(Lucide.Calendar, contentDescription = null, tint = Muted, modifier = Modifier.size(14.dp))
                    Text("В Noctgram с " + java.text.SimpleDateFormat("MMMM yyyy", java.util.Locale("ru")).format(java.util.Date(it)), color = Muted, fontSize = 13.sp)
                }
            }
            FlowRow(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                val followers = person.optLong("followers")
                val following = person.optLong("following")
                val count = person.optLong("postCount")
                Stat(followers, plural(followers, "подписчик", "подписчика", "подписчиков")) { model.open(Screen.Connections(id, followers = true)) }
                Stat(following, plural(following, "подписка", "подписки", "подписок")) { model.open(Screen.Connections(id, followers = false)) }
                Stat(count, plural(count, "публикация", "публикации", "публикаций"), toPosts)
            }
        }
    }
}

@Composable
private fun Stat(value: Long, label: String, onClick: () -> Unit) = Text(
    buildAnnotatedString {
        withStyle(SpanStyle(color = Foreground, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)) { append(groupedNumber(value)) }
        withStyle(SpanStyle(color = Muted, fontSize = 13.sp)) { append(" $label") }
    },
    modifier = Modifier.clip(RoundedCornerShape(6.dp)).clickable(onClick = onClick).padding(vertical = 6.dp),
)

@Composable
private fun Labelled(label: String, value: String, color: Color) = Text(
    buildAnnotatedString {
        withStyle(SpanStyle(color = Muted)) { append("$label ") }
        withStyle(SpanStyle(color = color, fontWeight = FontWeight.Medium)) { append(value) }
    },
    fontSize = 13.sp,
)

@Composable
private fun Presence(lastSeen: Long) {
    if (lastSeen <= 0) return
    val online = System.currentTimeMillis() - lastSeen < 120_000
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        if (online) Box(Modifier.size(7.dp).background(Green, CircleShape))
        Text(if (online) "в сети" else "был(а) ${relativeTime(lastSeen)} назад", color = if (online) Body else Muted, fontSize = 13.sp)
    }
}

@Composable
private fun ProfileSkeleton() = Column(Modifier.fillMaxWidth().padding(12.dp)) {
    Column(Modifier.fillMaxWidth().noctCard(RoundedCornerShape(20.dp))) {
        Box(Modifier.fillMaxWidth().height(156.dp).background(Cover))
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(Modifier.overlapUp(56.dp).size(102.dp).clip(CircleShape).background(Card).padding(5.dp).skeleton(CircleShape))
            Box(Modifier.width(180.dp).height(22.dp).skeleton())
            Box(Modifier.width(110.dp).height(14.dp).skeleton())
            Box(Modifier.fillMaxWidth().height(14.dp).skeleton())
        }
    }
}

private fun parseColor(hex: String): Color =
    runCatching { Color(android.graphics.Color.parseColor(hex)) }.getOrDefault(Color(0xFF9775CF))

/** Followers or subscriptions of an account, thirty at a time. */
@Composable
fun ConnectionsScreen(model: AppModel, screen: Screen.Connections) {
    var people by remember { mutableStateOf(listOf<JSONObject>()) }
    var cursor by remember { mutableStateOf<String?>("") }
    var loaded by remember { mutableStateOf(false) }
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
        loaded = true
    }
    LaunchedEffect(screen) { more() }
    Column(Modifier.fillMaxSize()) {
        TopBar(if (screen.followers) "Подписчики" else "Подписки", model::back)
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = 6.dp, bottom = 24.dp)) {
            if (error.isNotEmpty()) item { ErrorNote(error, Modifier.padding(16.dp)) }
            if (!loaded) items(6) {
                Row(Modifier.padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Box(Modifier.size(46.dp).skeleton(CircleShape))
                    Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                        Box(Modifier.width(140.dp).height(12.dp).skeleton())
                        Box(Modifier.width(90.dp).height(10.dp).skeleton())
                    }
                }
            }
            if (loaded && people.isEmpty() && error.isEmpty()) item {
                EmptyState(
                    Lucide.Users,
                    if (screen.followers) "Пока никого" else "Подписок пока нет",
                    if (screen.followers) "Когда на аккаунт подпишутся, люди появятся здесь." else "Аккаунты, на которые оформлена подписка, появятся здесь.",
                )
            }
            items(people, key = { it.optString("id") }) { person ->
                PersonRow(model.api, person, onClick = { model.open(Screen.Profile(person.optString("id"))) }) {
                    Icon(Lucide.ChevronRight, contentDescription = null, tint = Muted, modifier = Modifier.size(18.dp))
                }
            }
            if (cursor != null && people.isNotEmpty()) item {
                LaunchedEffect(people.size) { scope.launch { more() } }
                Text("Загружаем…", color = Muted, fontSize = 13.sp, modifier = Modifier.padding(16.dp))
            }
        }
    }
}
