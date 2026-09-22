package com.noctgram.app

import android.os.Build
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
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import org.json.JSONObject

private const val PAGE = 30

/** One list of posts: the home feed, or one author's posts on a profile. */
class FeedState(private val api: NoctApi, private val scope: CoroutineScope) {
    var posts by mutableStateOf(listOf<JSONObject>())
        private set
    var loading by mutableStateOf(false)
        private set
    var loadingMore by mutableStateOf(false)
        private set
    var hasMore by mutableStateOf(false)
        private set
    var error by mutableStateOf("")
        private set
    /** Likes and bookmarks the user just changed, shown at once while the request is in flight. */
    val liked = mutableStateMapOf<String, Boolean>()
    val saved = mutableStateMapOf<String, Boolean>()
    /** Poll answers given here, shown at once: post id to the chosen option. */
    val voted = mutableStateMapOf<String, Int>()

    private var query = mapOf("action" to "feed", "mode" to "all")
    // A slow answer to an old question must not overwrite the list the user now sees.
    private var generation = 0

    /** Screenshot tests: these posts, as if they had just arrived. */
    internal fun show(items: List<JSONObject>) {
        posts = items
        loading = false
        hasMore = false
    }

    fun reload(mode: String = "all", userId: String? = null) {
        query = buildMap {
            put("action", "feed")
            put("mode", mode)
            userId?.let { put("user", it) }
        }
        refresh()
    }

    fun refresh() {
        val request = ++generation
        loading = true
        error = ""
        scope.launch {
            try {
                val page = api.get("/api/social", query).objects("items")
                if (request == generation) {
                    posts = page
                    hasMore = page.size == PAGE
                    liked.clear()
                    saved.clear()
                    voted.clear()
                }
            } catch (failure: ApiException) {
                if (request == generation) error = failure.message.orEmpty()
            }
            if (request == generation) loading = false
        }
    }

    fun nextPage() {
        val last = posts.lastOrNull() ?: return
        if (loading || loadingMore || !hasMore) return
        val request = generation
        loadingMore = true
        scope.launch {
            try {
                val page = api.get("/api/social", query + mapOf("before" to last.optLong("created").toString(), "afterId" to last.optString("id")))
                    .objects("items")
                if (request == generation) {
                    val known = posts.mapTo(HashSet()) { it.optString("id") }
                    posts = posts + page.filter { it.optString("id") !in known }
                    hasMore = page.size == PAGE
                }
            } catch (failure: ApiException) {
                if (request == generation) error = failure.message.orEmpty()
            }
            loadingMore = false
        }
    }

    fun clear() {
        generation++
        posts = emptyList()
        hasMore = false
        loading = false
        error = ""
        liked.clear()
        saved.clear()
        voted.clear()
    }

    /** The option this account chose, or -1. */
    fun vote(post: JSONObject): Int = voted[post.optString("id")] ?: if (post.isNull("voted")) -1 else post.optInt("voted", -1)

    fun choose(post: JSONObject, option: Int) {
        val id = post.optString("id")
        val before = voted[id]
        voted[id] = option
        scope.launch {
            try {
                api.post("/api/social", JSONObject().put("action", "vote").put("id", id).put("option", option))
            } catch (failure: ApiException) {
                if (before == null) voted.remove(id) else voted[id] = before
                error = failure.message.orEmpty()
            }
        }
    }

    fun isLiked(post: JSONObject) = liked[post.optString("id")] ?: (post.optInt("liked") != 0)
    fun isSaved(post: JSONObject) = saved[post.optString("id")] ?: (post.optInt("saved") != 0)

    fun toggleLike(post: JSONObject) = toggle(post, "like", liked, isLiked(post))
    fun toggleSave(post: JSONObject) = toggle(post, "save", saved, isSaved(post))

    private fun toggle(post: JSONObject, action: String, state: MutableMap<String, Boolean>, current: Boolean) {
        val id = post.optString("id")
        val value = !current
        state[id] = value
        scope.launch {
            try {
                api.post("/api/social", JSONObject().put("action", action).put("id", id).put("value", value))
            } catch (failure: ApiException) {
                state[id] = !value
                error = failure.message.orEmpty()
            }
        }
    }
}

fun JSONObject.objects(name: String): List<JSONObject> =
    optJSONArray(name)?.let { array -> (0 until array.length()).mapNotNull(array::optJSONObject) } ?: emptyList()

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FeedScreen(model: AppModel) {
    val feed = model.homeFeed
    var mode by rememberSaveable { mutableIntStateOf(0) }
    val live = !LocalInspectionMode.current
    // A new own post (revision) belongs at the top of the feed at once.
    LaunchedEffect(mode, model.revision) { if (live) feed.reload(if (mode == 0) "all" else "following") }
    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().height(56.dp).padding(start = 18.dp, end = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Noctgram", fontFamily = Brand, fontWeight = FontWeight.SemiBold, fontSize = 24.sp, letterSpacing = (-0.6).sp, modifier = Modifier.weight(1f))
            IconAction(Lucide.SquarePen, "Новая публикация", tint = Foreground) { model.open(Screen.Composer) }
        }
        PullToRefreshBox(isRefreshing = feed.loading && feed.posts.isNotEmpty(), onRefresh = feed::refresh, modifier = Modifier.fillMaxSize()) {
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 12.dp, top = 4.dp, end = 12.dp, bottom = TabBarSpace),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item(key = "tabs") { Segmented(listOf("Для вас", "Подписки"), mode) { mode = it } }
                item(key = "compose") { ComposerPrompt(model) }
                posts(
                    model, feed,
                    empty = if (mode == 1) "Подпишитесь на авторов, и их публикации появятся здесь." else "Здесь появятся публикации всех, кто пишет в Noctgram.",
                )
            }
        }
    }
}

/** The site's «Что нового?» card: a tap opens the full editor. */
@Composable
private fun ComposerPrompt(model: AppModel) {
    val me = model.me ?: return
    Column(Modifier.fillMaxWidth().noctCard().clickable { model.open(Screen.Composer) }.padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Avatar(model.api, me.optString("avatar"), me.optString("name"), 40.dp)
            Text("Что нового?", color = Muted, fontSize = 17.sp)
        }
        HairlineDivider(Modifier.padding(top = 14.dp, bottom = 8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            for (icon in listOf(Lucide.Image, Lucide.Poll, Lucide.Code)) Box(Modifier.size(36.dp), Alignment.Center) {
                Icon(icon, contentDescription = null, tint = Secondary, modifier = Modifier.size(19.dp))
            }
            Spacer(Modifier.weight(1f))
            NoctButton("Опубликовать", onClick = {}, enabled = false, compact = true)
        }
    }
}

/** The cards plus the states around them; shared by the feed and the profile. */
fun LazyListScope.posts(model: AppModel, feed: FeedState, empty: String) {
    if (feed.error.isNotEmpty()) item(key = "error") { ErrorNote(feed.error, onRetry = feed::refresh) }
    if (feed.posts.isEmpty() && feed.loading) items(3, key = { "skeleton$it" }) { PostSkeleton() }
    if (feed.posts.isEmpty() && !feed.loading && feed.error.isEmpty())
        item(key = "empty") { EmptyState(Lucide.Sparkles, "Пока пусто", empty) }
    items(feed.posts, key = { it.optString("id") }) { post -> PostCard(model, feed, post) }
    if (feed.hasMore) item(key = "more") {
        LaunchedEffect(feed.posts.size) { feed.nextPage() }
        PostSkeleton()
    }
}

@Composable
fun PostSkeleton() = Column(Modifier.fillMaxWidth().noctCard().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.size(40.dp).skeleton(CircleShape))
        Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Box(Modifier.width(120.dp).height(12.dp).skeleton())
            Box(Modifier.width(80.dp).height(10.dp).skeleton())
        }
    }
    Box(Modifier.fillMaxWidth().height(12.dp).skeleton())
    Box(Modifier.fillMaxWidth(0.7f).height(12.dp).skeleton())
}

@Composable
fun PostCard(model: AppModel, feed: FeedState?, post: JSONObject) {
    val id = post.optString("id")
    Column(Modifier.fillMaxWidth().noctCard().padding(start = 16.dp, top = 14.dp, end = 8.dp, bottom = if (feed != null) 6.dp else 16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            val author = { model.open(Screen.Profile(post.optString("userId"))) }
            Avatar(model.api, post.optString("avatar"), post.optString("name"), 40.dp, Modifier.clickable(onClick = author))
            Column(Modifier.weight(1f).clickable(onClick = author)) {
                DisplayName(post)
                Text(
                    "@${post.optString("handle")} · ${relativeTime(post.optLong("created"))}",
                    color = Secondary, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
            PostMenu(id)
        }
        Column(Modifier.padding(top = 12.dp, end = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            post.optString("text").takeIf { it.isNotBlank() }?.let { PostBody(id, it) }
            post.optString("code").takeIf { it.isNotBlank() }?.let { CodeBlock(it, post.optString("codeLang")) }
            Media(model.api, post)
            Poll(post, feed)
        }
        if (feed != null) Row(Modifier.padding(top = 8.dp).offset(x = (-10).dp), verticalAlignment = Alignment.CenterVertically) {
            val liked = feed.isLiked(post)
            // The server count predates the tap; shift it by the difference the user just made.
            val likes = post.optInt("likes") + (if (liked) 1 else 0) - (if (post.optInt("liked") != 0) 1 else 0)
            Counter(if (liked) Lucide.HeartFilled else Lucide.Heart, likes.toLong(), if (liked) "Убрать лайк" else "Нравится", liked) { feed.toggleLike(post) }
            Counter(Lucide.MessageCircle, post.optLong("comments"), "Комментарии", false) { model.open(Screen.Comments(post)) }
            Row(Modifier.padding(horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(Lucide.Eye, contentDescription = "Просмотры", tint = Muted, modifier = Modifier.size(17.dp))
                Text(groupedNumber(post.optLong("views")), color = Muted, fontSize = 13.sp)
            }
            // Stars readers gave the author; sending them stays on the site for now.
            if (post.optLong("stars") > 0) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                Icon(Lucide.StarFilled, contentDescription = "Noct Stars", tint = Gold, modifier = Modifier.size(15.dp))
                Text(groupedNumber(post.optLong("stars")), color = Gold, fontSize = 13.sp, fontWeight = FontWeight.Medium)
            }
            Spacer(Modifier.weight(1f))
            val saved = feed.isSaved(post)
            IconAction(
                if (saved) Lucide.BookmarkFilled else Lucide.Bookmark,
                if (saved) "Убрать из сохранённого" else "Сохранить",
                tint = if (saved) Foreground else Secondary,
                iconSize = 19.dp,
                modifier = Modifier.offset(x = 10.dp),
            ) { feed.toggleSave(post) }
        }
    }
}

/** Long posts fold after eight lines behind «Ещё», as on the site. */
@Composable
private fun PostBody(id: String, text: String) {
    var expanded by rememberSaveable(id) { mutableStateOf(false) }
    var folded by remember(id) { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
            text,
            color = PostText,
            fontSize = 15.sp,
            lineHeight = 24.sp,
            maxLines = if (expanded) Int.MAX_VALUE else 8,
            overflow = TextOverflow.Ellipsis,
            onTextLayout = { if (!expanded) folded = it.hasVisualOverflow },
        )
        if (folded && !expanded) Text("Ещё", color = Foreground, fontSize = 14.sp, fontWeight = FontWeight.Medium, modifier = Modifier.clip(RoundedCornerShape(6.dp)).clickable { expanded = true })
    }
}

@Composable
private fun PostMenu(id: String) {
    var open by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    Box {
        IconAction(Lucide.Ellipsis, "Действия с публикацией", size = 36.dp, iconSize = 18.dp) { open = true }
        DropdownMenu(open, { open = false }, shape = RoundedCornerShape(14.dp), containerColor = Popover, border = androidx.compose.foundation.BorderStroke(1.dp, Hairline)) {
            DropdownMenuItem(
                text = { Text("Скопировать ссылку", fontSize = 14.sp) },
                leadingIcon = { Icon(Lucide.Link, contentDescription = null, tint = Secondary, modifier = Modifier.size(18.dp)) },
                onClick = {
                    open = false
                    copyText(context, clipboard, "${NoctApi.ORIGIN}/?post=$id", "Адрес")
                },
            )
        }
    }
}

@Composable
private fun Counter(icon: ImageVector, count: Long, label: String, active: Boolean, onClick: () -> Unit) = Row(
    Modifier.height(40.dp).clip(CircleShape).clickable(onClickLabel = label, onClick = onClick).padding(horizontal = 10.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(7.dp),
) {
    Icon(icon, contentDescription = label, tint = if (active) Foreground else Secondary, modifier = Modifier.size(19.dp))
    Text(groupedNumber(count), color = if (active) Foreground else Secondary, fontSize = 13.sp)
}

/** The site's code block: language and a copy button above a horizontally scrolling monospace body. */
@Composable
fun CodeBlock(code: String, language: String) {
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Color(0xFF070707)).border(1.dp, Hairline, RoundedCornerShape(12.dp))) {
        Row(Modifier.fillMaxWidth().height(38.dp).padding(start = 12.dp, end = 2.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Lucide.Code, contentDescription = null, tint = Muted, modifier = Modifier.size(14.dp))
            Text(
                language.takeIf { it.isNotBlank() && it != "text" } ?: "код",
                color = Muted, fontSize = 12.sp, fontFamily = FontFamily.Monospace,
                modifier = Modifier.padding(start = 8.dp).weight(1f),
            )
            IconAction(Lucide.Copy, "Скопировать код", size = 34.dp, iconSize = 15.dp) { copyText(context, clipboard, code, "Код") }
        }
        HairlineDivider()
        Text(
            code, fontFamily = FontFamily.Monospace, fontSize = 13.sp, lineHeight = 20.sp, color = Color(0xFFE6E6E6), softWrap = false,
            modifier = Modifier.horizontalScroll(rememberScrollState()).padding(12.dp),
        )
    }
}

@Composable
private fun Media(api: NoctApi, post: JSONObject) {
    val media = post.objects("media")
    if (media.isEmpty()) return
    // 18+ hides only the pictures, until the reader asks: the same rule as the site.
    var revealed by rememberSaveable(post.optString("id")) { mutableStateOf(post.optInt("adult") == 0) }
    val rows = if (media.size == 1) listOf(media) else media.chunked(2)
    Box {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            for (row in rows) Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                for (item in row) {
                    val height = when {
                        media.size == 1 -> 280.dp
                        row.size == 1 -> 190.dp
                        else -> 170.dp
                    }
                    val frame = Modifier.weight(1f).height(height).clip(RoundedCornerShape(12.dp))
                    when {
                        // Without blur (before Android 12) an 18+ picture is not drawn at all.
                        !revealed && Build.VERSION.SDK_INT < 31 -> Box(frame.background(Cover))
                        item.optString("type").startsWith("image/") -> NetImage(
                            api, "/api/media/" + item.optString("id"),
                            if (revealed) frame else frame.blur(28.dp),
                        )
                        // ponytail: no video player yet; add Media3 when videos matter in the app.
                        else -> Box(frame.background(Cover), Alignment.Center) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Icon(Lucide.Eye, contentDescription = null, tint = Secondary, modifier = Modifier.size(22.dp))
                                Text("Видео открывается на сайте", color = Secondary, fontSize = 13.sp)
                            }
                        }
                    }
                }
            }
        }
        if (!revealed) Row(
            Modifier.align(Alignment.Center).clip(CircleShape).background(Background.copy(alpha = 0.72f)).border(1.dp, Border, CircleShape)
                .clickable { revealed = true }.padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(Lucide.EyeOff, contentDescription = null, tint = Foreground, modifier = Modifier.size(16.dp))
            Text("18+ · Показать", color = Foreground, fontSize = 13.sp, fontWeight = FontWeight.Medium)
        }
    }
}

/** Results as bars. A tap on an answer votes, and another tap changes the vote, as on the site. */
@Composable
private fun Poll(post: JSONObject, feed: FeedState?) {
    val options = post.optJSONArray("poll") ?: return
    if (options.length() == 0) return
    val counts = post.objects("votes").associate { it.optInt("option") to it.optInt("count") }.toMutableMap()
    // The server counts include the vote this account had; move it to the new choice.
    val server = if (post.isNull("voted")) -1 else post.optInt("voted", -1)
    val mine = feed?.vote(post) ?: server
    if (mine != server) {
        if (server >= 0) counts[server] = ((counts[server] ?: 1) - 1).coerceAtLeast(0)
        if (mine >= 0) counts[mine] = (counts[mine] ?: 0) + 1
    }
    val total = counts.values.sum()
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        for (index in 0 until options.length()) {
            val share = if (total == 0) 0f else (counts[index] ?: 0).toFloat() / total
            val chosen = index == mine
            Box(
                Modifier.fillMaxWidth().height(42.dp).clip(RoundedCornerShape(12.dp)).background(Fill6)
                    .border(1.dp, if (chosen) Border else Color.Transparent, RoundedCornerShape(12.dp))
                    .clickable(enabled = feed != null && !chosen) { feed?.choose(post, index) },
            ) {
                Box(Modifier.fillMaxHeight().fillMaxWidth(share).background(if (chosen) Fill14 else Fill10))
                Row(
                    Modifier.fillMaxSize().padding(horizontal = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (chosen) Icon(Lucide.Check, contentDescription = "Ваш голос", tint = Foreground, modifier = Modifier.size(15.dp))
                    Text(options.optString(index), color = if (chosen) Foreground else PostText, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    Text("${(share * 100).toInt()} %", color = Secondary, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                }
            }
        }
        Text(
            "${groupedNumber(total.toLong())} ${plural(total.toLong(), "голос", "голоса", "голосов")}" + if (mine < 0 && feed != null) " · выберите ответ" else "",
            color = Muted, fontSize = 12.sp, modifier = Modifier.padding(top = 2.dp),
        )
    }
}
