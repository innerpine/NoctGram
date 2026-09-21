package com.noctgram.app

import android.app.Application
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.Dispatchers
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

/** Who is signed in and which screen that implies; the same decisions as the iOS NativeSession. */
class AppModel(app: Application) : AndroidViewModel(app) {
    val api = NoctApi(KeystoreSessionStore(app))
    val homeFeed = FeedState(api, viewModelScope)
    val profileFeed = FeedState(api, viewModelScope)
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

    init {
        api.onSessionExpired = { viewModelScope.launch(Dispatchers.Main) { expire() } }
        refresh()
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
        profileFeed.clear()
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
        Phase.SignedIn -> MainScreen(model)
    }
}

@Composable
private fun MainScreen(model: AppModel) {
    var tab by rememberSaveable { mutableIntStateOf(0) }
    val tabs = listOf("Лента" to Icons.Default.Home, "Сообщения" to Icons.Default.Email, "Профиль" to Icons.Default.Person)
    Scaffold(
        containerColor = Background,
        bottomBar = {
            NavigationBar(containerColor = Background) {
                tabs.forEachIndexed { index, (label, icon) ->
                    NavigationBarItem(
                        selected = tab == index,
                        onClick = { tab = index },
                        icon = { Icon(icon, contentDescription = null) },
                        label = { Text(label) },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = Foreground,
                            selectedTextColor = Foreground,
                            unselectedIconColor = Muted,
                            unselectedTextColor = Muted,
                            indicatorColor = Segment,
                        ),
                    )
                }
            }
        },
    ) { insets ->
        Box(Modifier.fillMaxSize().padding(insets)) {
            when (tab) {
                0 -> FeedScreen(model)
                1 -> Placeholder("Сообщения", "Личные и групповые чаты появятся в следующих версиях. Пока они доступны на noctgram.com.")
                else -> ProfileScreen(model)
            }
        }
    }
}
