package com.noctgram.app

import android.app.Application
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { NoctTheme { NoctApp() } }
    }
}

enum class Phase { Loading, SignedOut, Onboarding, SignedIn, Unavailable }

/** A screen opened on top of the tabs. The back gesture closes the newest one. */
sealed interface Screen {
    class Profile(val id: String) : Screen
    class Connections(val id: String, val followers: Boolean) : Screen
    class Comments(val post: JSONObject) : Screen
    class Chat(val id: String, val name: String, val avatar: String, val room: Boolean) : Screen
    data object Composer : Screen
    data object EditProfile : Screen
    data object Design : Screen
}

/** Who is signed in and which screen that implies; the same decisions as the iOS NativeSession. */
class AppModel(app: Application) : AndroidViewModel(app) {
    val api = NoctApi(KeystoreSessionStore(app))
    val homeFeed = FeedState(api, viewModelScope)
    val chats = ChatList(api, viewModelScope)
    val stack = mutableStateListOf<Screen>()
    var phase by mutableStateOf(Phase.Loading)
        private set
    var me by mutableStateOf<JSONObject?>(null)
        private set
    var emailEnabled by mutableStateOf(true)
        private set
    /** The address a code was already sent to, so a restart returns to the code step. */
    var pendingEmail by mutableStateOf("")
        private set
    var error by mutableStateOf("")
        private set
    /** Bumped when the account's own profile or posts changed, so open screens reload. */
    var revision by mutableIntStateOf(0)
        private set

    val myId get() = me?.optString("id").orEmpty()

    init {
        api.onSessionExpired = { viewModelScope.launch(Dispatchers.Main) { expire() } }
        refresh()
    }

    fun open(screen: Screen) { stack.add(screen) }
    fun back() { stack.removeLastOrNull() }

    /** The server returned the updated own profile (after an edit or a new design). */
    fun updated(profile: JSONObject? = null) {
        if (profile != null && profile.optString("id") == myId) me = profile
        revision++
    }

    fun refresh() = viewModelScope.launch {
        try {
            val status = api.get("/api/auth/session")
            emailEnabled = status.optBoolean("emailEnabled", true)
            pendingEmail = status.optJSONObject("challenge")?.optString("email").orEmpty()
            val user = status.optJSONObject("user")
            when {
                user == null || user.optString("id").isEmpty() -> expire()
                !user.optBoolean("onboardingComplete") -> { me = user; phase = Phase.Onboarding }
                else -> {
                    me = api.get("/api/social", mapOf("action" to "bootstrap")).optJSONObject("me")
                        ?: throw ApiException(0, "INVALID_RESPONSE", "Сервер не вернул профиль. Попробуйте ещё раз.")
                    phase = Phase.SignedIn
                }
            }
            error = ""
        } catch (failure: ApiException) {
            when {
                failure.unauthorized -> expire()
                failure.onboardingRequired -> phase = Phase.Onboarding
                else -> {
                    error = failure.message.orEmpty()
                    if (phase != Phase.SignedIn) phase = Phase.Unavailable
                }
            }
        }
    }

    fun signOut() = viewModelScope.launch {
        // The device forgets the account even when it is offline.
        runCatching { api.post("/api/auth/logout", JSONObject()) }
        expire()
    }

    private fun expire() {
        api.clearSession()
        // Nothing of the previous account may flash in front of the next one.
        ImageCache.clear()
        homeFeed.clear()
        chats.clear()
        stack.clear()
        me = null
        phase = Phase.SignedOut
    }
}

@Composable
fun NoctApp(model: AppModel = viewModel()) {
    when (model.phase) {
        Phase.Loading -> Box(Modifier.fillMaxSize(), Alignment.Center) { Text("noctgram", color = Muted) }
        Phase.Unavailable -> FullScreenError(model.error) { model.refresh() }
        Phase.SignedOut -> LoginScreen(model)
        Phase.Onboarding -> OnboardingScreen(model)
        Phase.SignedIn -> SignedIn(model)
    }
}

@Composable
private fun SignedIn(model: AppModel) {
    var tab by rememberSaveable { mutableIntStateOf(0) }
    // Unread counts for the badge: on entry, then quietly while the app is open.
    LaunchedEffect(model.myId) {
        while (true) {
            model.chats.reload()
            delay(20_000)
        }
    }
    Box(Modifier.fillMaxSize().background(Background)) {
        // The tabs stay composed under an opened screen, so the feed keeps its place.
        Box(Modifier.fillMaxSize().statusBarsPadding()) {
            when (tab) {
                0 -> FeedScreen(model)
                1 -> ChatListScreen(model)
                else -> ProfileScreen(model, model.myId, onBack = null)
            }
        }
        if (model.stack.isEmpty()) TabBar(model, tab, Modifier.align(Alignment.BottomCenter)) { tab = it }
        model.stack.lastOrNull()?.let { screen ->
            BackHandler { model.back() }
            // Swallow taps on empty space: without this they reach the tab underneath.
            Box(Modifier.fillMaxSize().background(Background).pointerInput(Unit) { detectTapGestures { } }) {
                // Every opened screen starts with its own state, even after another of the same kind.
                key(screen) {
                    when (screen) {
                        is Screen.Profile -> ProfileScreen(model, screen.id, onBack = model::back)
                        is Screen.Connections -> ConnectionsScreen(model, screen)
                        is Screen.Comments -> CommentsScreen(model, screen.post)
                        is Screen.Chat -> ChatScreen(model, screen)
                        Screen.Composer -> ComposerScreen(model)
                        Screen.EditProfile -> EditProfileScreen(model)
                        Screen.Design -> DesignScreen(model)
                    }
                }
            }
        }
    }
}

/** The floating pill bar: a highlighted capsule behind the current tab, the account's face on the last one. */
@Composable
private fun TabBar(model: AppModel, selected: Int, modifier: Modifier, onSelect: (Int) -> Unit) = Row(
    modifier.navigationBarsPadding().padding(horizontal = 16.dp, vertical = 10.dp).fillMaxWidth()
        .clip(RoundedCornerShape(36.dp)).background(Popover).border(1.dp, Hairline, RoundedCornerShape(36.dp)).padding(6.dp),
    horizontalArrangement = Arrangement.spacedBy(4.dp),
) {
    val tabs: List<Pair<String, ImageVector?>> = listOf("Лента" to Glyphs.Feed, "Чаты" to Glyphs.Chats, "Профиль" to null)
    tabs.forEachIndexed { index, (label, icon) ->
        val active = index == selected
        val tint = if (active) Accent else Body
        Column(
            Modifier.weight(1f).clip(RoundedCornerShape(30.dp)).background(if (active) Accent.copy(alpha = 0.14f) else Popover)
                .clickable(remember { MutableInteractionSource() }, indication = null) { onSelect(index) }
                .padding(vertical = 8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Box {
                if (icon != null) Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(26.dp))
                else Avatar(model.api, model.me?.optString("avatar").orEmpty(), model.me?.optString("name").orEmpty(), 26.dp)
                if (index == 1 && model.chats.unread > 0) Text(
                    if (model.chats.unread > 99) "99+" else model.chats.unread.toString(),
                    color = Foreground, fontSize = 10.sp, fontWeight = FontWeight.Medium,
                    modifier = Modifier.align(Alignment.TopEnd).padding(start = 18.dp)
                        .background(Danger, CircleShape).padding(horizontal = 5.dp, vertical = 1.dp),
                )
            }
            Text(label, color = tint, fontSize = 12.sp, fontWeight = FontWeight.Medium)
        }
    }
}
