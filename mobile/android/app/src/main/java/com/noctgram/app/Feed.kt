package com.noctgram.app

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
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
    /** Likes the user just changed, shown at once while the request is in flight. */
    val liked = mutableStateMapOf<String, Boolean>()

    private var query = mapOf("action" to "feed", "mode" to "all")
    // A slow answer to an old question must not overwrite the list the user now sees.
    private var generation = 0

    fun reload(mode: String = "all", userId: String? = null) {
        val request = ++generation
        query = buildMap {
            put("action", "feed")
            put("mode", mode)
            userId?.let { put("user", it) }
        }
        loading = true
        error = ""
        scope.launch {
            try {
                val page = api.get("/api/social", query).objects("items")
                if (request == generation) {
                    posts = page
                    hasMore = page.size == PAGE
                    liked.clear()
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
    }

    fun isLiked(post: JSONObject) = liked[post.optString("id")] ?: (post.optInt("liked") != 0)

    fun toggleLike(post: JSONObject) {
        val id = post.optString("id")
        val value = !isLiked(post)
        liked[id] = value
        scope.launch {
            try {
                api.post("/api/social", JSONObject().put("action", "like").put("id", id).put("value", value))
            } catch (failure: ApiException) {
                liked[id] = !value
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
    var mode by rememberSaveable { mutableStateOf("all") }
    LaunchedEffect(mode) { feed.reload(mode) }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(16.dp, 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for ((id, label) in listOf("all" to "Для вас", "following" to "Подписки")) Text(
                label,
                color = if (mode == id) Foreground else Muted,
                fontWeight = FontWeight.Medium,
                modifier = Modifier.clip(RoundedCornerShape(50))
                    .background(if (mode == id) Segment else Background)
                    .clickable { mode = id }
                    .padding(16.dp, 8.dp),
            )
        }
        PullToRefreshBox(isRefreshing = feed.loading, onRefresh = { feed.reload(mode) }, modifier = Modifier.fillMaxSize()) {
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp, 4.dp, 16.dp, 16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) { posts(model.api, feed, emptyText = if (mode == "following") "Подпишитесь на авторов — их публикации появятся здесь." else "Публикаций пока нет.") }
        }
    }
}

/** The cards plus the states around them; shared by the feed and the profile. */
fun LazyListScope.posts(api: NoctApi, feed: FeedState, emptyText: String) {
    if (feed.error.isNotEmpty()) item { Text(feed.error, color = Danger, modifier = Modifier.padding(vertical = 8.dp)) }
    if (feed.posts.isEmpty() && !feed.loading && feed.error.isEmpty())
        item { Text(emptyText, color = Muted, modifier = Modifier.padding(vertical = 32.dp)) }
    items(feed.posts, key = { it.optString("id") }) { post -> PostCard(api, feed, post) }
    if (feed.hasMore) item {
        LaunchedEffect(feed.posts.size) { feed.nextPage() }
        Text("Загружаем…", color = Muted, modifier = Modifier.fillMaxWidth().padding(16.dp))
    }
}

@Composable
private fun PostCard(api: NoctApi, feed: FeedState, post: JSONObject) = Column(
    Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Card)
        .border(1.dp, Hairline, RoundedCornerShape(16.dp)).padding(20.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp),
) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Avatar(api, post.optString("avatar"), post.optString("name"), 40.dp)
        Column(Modifier.weight(1f)) {
            Text(post.optString("name"), fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("@${post.optString("handle")} · ${relativeTime(post.optLong("created"))}", color = Muted, fontSize = 13.sp, maxLines = 1)
        }
    }
    post.optString("text").takeIf { it.isNotBlank() }?.let { Text(it, color = Body, lineHeight = 24.sp) }
    post.optString("code").takeIf { it.isNotBlank() }?.let {
        Text(
            it, fontFamily = FontFamily.Monospace, fontSize = 13.sp, color = Body,
            modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Background)
                .horizontalScroll(rememberScrollState()).padding(12.dp),
        )
    }
    Media(api, post)
    Poll(post)
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        val liked = feed.isLiked(post)
        // The server count predates the tap; shift it by the difference the user just made.
        val likes = post.optInt("likes") + (if (liked) 1 else 0) - (if (post.optInt("liked") != 0) 1 else 0)
        Icon(
            if (liked) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
            contentDescription = if (liked) "Убрать лайк" else "Нравится",
            tint = if (liked) Danger else Muted,
            modifier = Modifier.size(36.dp).clip(RoundedCornerShape(50)).clickable { feed.toggleLike(post) }.padding(8.dp),
        )
        Text(groupedNumber(likes.toLong()), color = Muted, fontSize = 13.sp)
        Text("· ${groupedNumber(post.optLong("comments"))} комм. · ${groupedNumber(post.optLong("views"))} просм.", color = Muted, fontSize = 13.sp)
    }
}

@Composable
private fun Media(api: NoctApi, post: JSONObject) {
    val media = post.objects("media")
    if (media.isEmpty()) return
    // 18+ hides only the pictures, until the reader asks: the same rule as the site.
    var revealed by rememberSaveable(post.optString("id")) { mutableStateOf(post.optInt("adult") == 0) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for (item in media) {
            val shape = RoundedCornerShape(12.dp)
            val frame = Modifier.fillMaxWidth().height(220.dp).clip(shape)
            when {
                !revealed -> Box(frame.background(Segment).clickable { revealed = true }, Alignment.Center) { Text("18+ · Показать", color = Body) }
                item.optString("type").startsWith("image/") -> NetImage(api, "/api/media/" + item.optString("id"), frame)
                // ponytail: no video player in the base; add Media3 when videos matter in the app.
                else -> Box(frame.background(Segment), Alignment.Center) { Text("Видео · откройте на noctgram.com", color = Muted) }
            }
        }
    }
}

@Composable
private fun Poll(post: JSONObject) {
    val options = post.optJSONArray("poll") ?: return
    if (options.length() == 0) return
    val votes = post.objects("votes").associate { it.optInt("option") to it.optInt("count") }
    val total = votes.values.sum()
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        for (index in 0 until options.length()) Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Background).padding(12.dp, 10.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(options.optString(index), color = Body, modifier = Modifier.weight(1f))
            Text(if (total == 0) "0%" else "${(votes[index] ?: 0) * 100 / total}%", color = Muted)
        }
        Text("${groupedNumber(total.toLong())} голосов · голосование на сайте", color = Muted, fontSize = 13.sp)
    }
}
