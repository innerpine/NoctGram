package com.noctgram.app

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONObject

/** The signed-in account: header from the full profile, then its own publications. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileScreen(model: AppModel) {
    val scope = rememberCoroutineScope()
    val id = model.me?.optString("id").orEmpty()
    // The bootstrap record is enough to draw at once; the full profile adds counts and the number.
    var profile by remember(id) { mutableStateOf(model.me) }
    var error by remember { mutableStateOf("") }
    val load: () -> Unit = {
        model.profileFeed.reload(userId = id)
        scope.launch {
            try {
                profile = model.api.get("/api/social", mapOf("action" to "profile", "id" to id))
                error = ""
            } catch (failure: ApiException) { error = failure.message.orEmpty() }
        }
    }
    LaunchedEffect(id) { load() }
    val person = profile ?: return
    PullToRefreshBox(isRefreshing = model.profileFeed.loading, onRefresh = load, modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            item { Header(model, person) }
            if (error.isNotEmpty()) item { Text(error, color = Danger) }
            posts(model.api, model.profileFeed, emptyText = "Здесь появятся ваши публикации.")
        }
    }
}

@Composable
private fun Header(model: AppModel, person: JSONObject) = Column(
    Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Card).border(1.dp, Hairline, RoundedCornerShape(16.dp)),
) {
    val avatar = person.optString("avatar")
    val cover = person.optString("cover")
    Box(Modifier.fillMaxWidth().height(140.dp).background(Segment)) {
        when {
            // ponytail: «Жидкое» is a still, blurred avatar here (blur needs Android 12+).
            // Animate it with an AGSL RuntimeShader (Android 13+) when the banner matters in the app.
            cover == "liquid" && avatar.isNotEmpty() -> NetImage(model.api, avatar, Modifier.fillMaxSize().blur(48.dp), maxSide = 256)
            cover.startsWith("/api/") -> NetImage(model.api, cover, Modifier.fillMaxSize())
        }
    }
    Column(Modifier.padding(20.dp, 0.dp, 20.dp, 20.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.offset(y = (-40).dp).clip(CircleShape).background(Card).padding(4.dp)) {
            Avatar(model.api, avatar, person.optString("name"), 96.dp)
        }
        Column(Modifier.offset(y = (-32).dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(person.optString("name"), fontSize = 29.sp, fontWeight = FontWeight.Medium, letterSpacing = (-1.2).sp)
            Text("@" + person.optString("handle"), color = Body)
            val aliases = person.optJSONArray("handles")
                ?.let { list -> (0 until list.length()).map(list::optString) }
                ?.filter { it != person.optString("handle") }.orEmpty()
            if (aliases.isNotEmpty()) Text("а также " + aliases.joinToString(", ") { "@$it" }, color = Muted, fontSize = 13.sp)
            person.optString("anonymousNumber").takeIf { it.length == 8 }?.let {
                Text("Анонимный номер +888 ${it.take(4)} ${it.drop(4)}", color = Muted, fontSize = 13.sp)
            }
            person.optString("bio").takeIf { it.isNotBlank() }?.let { Text(it, color = Body, modifier = Modifier.padding(top = 8.dp)) }
            Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                for ((key, label) in listOf("followers" to "подписчиков", "following" to "подписок", "postCount" to "публикаций"))
                    Text("${groupedNumber(person.optLong(key))} $label", color = Muted, fontSize = 13.sp)
            }
            OutlinedButton(onClick = { model.signOut() }, modifier = Modifier.padding(top = 12.dp)) { Text("Выйти", color = Foreground) }
        }
    }
}
