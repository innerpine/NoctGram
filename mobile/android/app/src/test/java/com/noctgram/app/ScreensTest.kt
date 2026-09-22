package com.noctgram.app

import android.app.Application
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.Shader
import androidx.activity.compose.LocalActivityResultRegistryOwner
import androidx.activity.result.ActivityResultRegistry
import androidx.activity.result.ActivityResultRegistryOwner
import androidx.activity.result.contract.ActivityResultContract
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.unit.dp
import androidx.core.app.ActivityOptionsCompat
import androidx.compose.ui.graphics.asImageBitmap
import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Rule
import org.junit.Test
import java.io.IOException

/**
 * Renders the app's screens on a virtual Pixel 5 with made-up data and no network:
 *   ./gradlew recordPaparazziDebug   writes the pictures to app/src/test/snapshots/images
 */
class ScreensTest {
    @get:Rule val paparazzi = Paparazzi(
        deviceConfig = DeviceConfig.PIXEL_5,
        theme = "android:Theme.Material.NoActionBar",
        maxPercentDifference = 1.0,
    )

    private val now = System.currentTimeMillis()
    private val minute = 60_000L

    private fun picture(url: String, width: Int, height: Int, from: Int, to: Int, moon: Boolean = false) {
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), Paint().apply {
            shader = LinearGradient(0f, 0f, width.toFloat(), height.toFloat(), from, to, Shader.TileMode.CLAMP)
        })
        canvas.drawCircle(width * 0.7f, height * 0.35f, height * 0.22f, Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = RadialGradient(width * 0.7f, height * 0.35f, height * 0.22f, 0xFFFFF1DC.toInt(), 0x00FFF1DC, Shader.TileMode.CLAMP)
        })
        if (moon) canvas.drawCircle(width * 0.62f, height * 0.4f, height * 0.16f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFFFFF3E2.toInt() })
        val hill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF1A1036.toInt() }
        canvas.drawOval(-width * 0.2f, height * 0.72f, width * 0.8f, height * 1.4f, hill)
        canvas.drawOval(width * 0.3f, height * 0.78f, width * 1.3f, height * 1.5f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF2B1850.toInt() })
        ImageCache.put(url, bitmap.asImageBitmap())
    }

    // Bitmaps need the rendering engine, which the rule starts only when a test runs.
    private fun pictures() {
        picture("/api/media/me", 256, 256, 0xFF221A5C.toInt(), 0xFFFF9A6B.toInt(), moon = true)
        picture("/api/media/seedy", 256, 256, 0xFF0F2A3D.toInt(), 0xFF6CB6FF.toInt())
        picture("/api/media/lena", 256, 256, 0xFF3D1030.toInt(), 0xFFFFA8CB.toInt())
        picture("/api/media/dev", 256, 256, 0xFF102A1E.toInt(), 0xFF87E7D6.toInt())
        picture("/api/media/city", 1080, 720, 0xFF0B1024.toInt(), 0xFF6B4FB0.toInt(), moon = true)
        picture("/api/media/sea", 720, 720, 0xFF06202F.toInt(), 0xFF3F8FB5.toInt())
        picture("/api/media/sun", 720, 720, 0xFF3A1320.toInt(), 0xFFFFB36B.toInt())
        picture("/api/media/cover", 1080, 400, 0xFF1B1446.toInt(), 0xFF8A4BB8.toInt())
    }

    private val account = JSONObject()
        .put("id", "me").put("name", "Мира Лунная").put("handle", "mira").put("avatar", "/api/media/me")
        .put("cover", "/api/media/cover").put("premium", 1).put("profileTheme", "iris").put("nameGradient", 1)
        .put("ringText", "").put("chromeFlow", 1).put("chromeTempo", 11)
        .put("bio", "Рисую ночные города и собираю плейлисты для долгих поездок. Пишу про дизайн интерфейсов.")
        .put("created", now - 400L * 24 * 60 * minute).put("followers", 1284).put("following", 312).put("postCount", 87)
        .put("handles", JSONArray(listOf("mira", "noct_mira", "lunar"))).put("anonymousNumber", "07142026").put("lastSeen", now)

    private val seedy = JSONObject().put("id", "seedy").put("name", "Seedy").put("handle", "root").put("avatar", "/api/media/seedy")
        .put("premium", 1).put("profileTheme", "ocean").put("nameGradient", 0).put("verified", 1)

    private fun post(id: String, author: JSONObject, ago: Long, text: String) = JSONObject(author.toString())
        .put("id", id).put("userId", author.optString("id")).put("text", text).put("created", now - ago)
        .put("likes", 24).put("comments", 6).put("views", 1532).put("liked", 0).put("saved", 0).put("media", JSONArray())

    private val samplePosts = listOf(
        post("p1", seedy, 7 * minute, "Ночной город с крыши, 02:14. Дождь закончился минут десять назад, и всё отражается в асфальте.")
            .put("media", JSONArray().put(JSONObject().put("id", "city").put("type", "image/jpeg"))).put("liked", 1).put("likes", 25).put("stars", 40),
        post("p2", account, 3 * 60 * minute, "Собрала плейлист «Огни трассы»: 42 трека для ночной дороги. Ссылка в профиле.")
            .put("poll", JSONArray(listOf("Синтвейв", "Эмбиент", "Постпанк")))
            .put("votes", JSONArray().put(JSONObject().put("option", 0).put("count", 18)).put(JSONObject().put("option", 1).put("count", 9)).put(JSONObject().put("option", 2).put("count", 5)))
            .put("voted", 0),
        post("p3", JSONObject().put("id", "dev").put("name", "Дима Кодов").put("handle", "dimacode").put("avatar", "/api/media/dev"), 26 * 60 * minute, "Маленький трюк для Compose: отрицательный отступ, который не оставляет дыру.")
            .put("code", "fun Modifier.overlapUp(amount: Dp) = layout { m, c ->\n    val p = m.measure(c)\n    layout(p.width, p.height - amount.roundToPx()) { p.place(0, -amount.roundToPx()) }\n}")
            .put("codeLang", "kotlin").put("saved", 1),
        post("p4", JSONObject().put("id", "lena").put("name", "Лена Сон").put("handle", "lenason").put("avatar", "/api/media/lena").put("premium", 1).put("profileTheme", "rose").put("nameGradient", 1), 2 * 24 * 60 * minute, "Два вида с одного балкона: утро и вечер.")
            .put("media", JSONArray().put(JSONObject().put("id", "sea").put("type", "image/jpeg")).put(JSONObject().put("id", "sun").put("type", "image/jpeg"))),
    )

    private fun model(): AppModel {
        pictures()
        val offline = NoctApi(MemorySessionStore(), transport = { _, _ -> throw IOException("offline") })
        return AppModel(Application(), offline, start = false, scope = CoroutineScope(SupervisorJob())).apply {
            preview(account)
            homeFeed.show(samplePosts)
            chats.show(
                listOf(
                    JSONObject(seedy.toString()).put("lastText", "Скинь потом исходник обложки?").put("lastTime", now - 4 * minute).put("unread", 2),
                    JSONObject().put("id", "g1").put("room", true).put("kind", "group").put("name", "Noctgram | Общение").put("avatar", "/api/media/me")
                        .put("lastText", "Розыгрыш: 3 × 100 Noct Stars").put("lastTime", now - 50 * minute).put("unread", 14),
                    JSONObject().put("id", "lena").put("name", "Лена Сон").put("avatar", "/api/media/lena").put("premium", 1).put("profileTheme", "rose").put("nameGradient", 1)
                        .put("lastText", "Спасибо! Завтра пришлю варианты").put("lastTime", now - 5 * 60 * minute),
                    JSONObject().put("id", "s1").put("room", true).put("kind", "secret").put("name", "Секретик").put("avatar", "")
                        .put("lastText", "Зашифрованное сообщение").put("lastTime", now - 2 * 24 * 60 * minute),
                    JSONObject().put("id", "dev").put("name", "Дима Кодов").put("avatar", "/api/media/dev")
                        .put("lastText", "Посмотри мой PR, там про оверлей").put("lastTime", now - 9 * 24 * 60 * minute),
                ),
            )
        }
    }

    /** No system photo picker in the renderer: launching one does nothing here. */
    private val results = object : ActivityResultRegistryOwner {
        override val activityResultRegistry = object : ActivityResultRegistry() {
            override fun <I, O> onLaunch(requestCode: Int, contract: ActivityResultContract<I, O>, input: I, options: ActivityOptionsCompat?) = Unit
        }
    }

    // Preview mode keeps screens from asking the (absent) server; the black ground is the activity's window.
    private fun shot(name: String, content: @Composable () -> Unit) = paparazzi.snapshot(name) {
        CompositionLocalProvider(LocalInspectionMode provides true, LocalActivityResultRegistryOwner provides results) {
            NoctTheme { Box(Modifier.fillMaxSize().background(Background)) { content() } }
        }
    }

    @Test fun feed() {
        val model = model()
        shot("feed") { SignedIn(model, startTab = 0) }
    }

    /** Every kind of post card on one tall screen: photo, poll, code, two photos. */
    @Test fun posts() {
        val model = model()
        paparazzi.unsafeUpdateConfig(deviceConfig = DeviceConfig.PIXEL_5.copy(screenHeight = 6200))
        shot("posts") {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                for (post in samplePosts) PostCard(model, model.homeFeed, post)
            }
        }
    }

    @Test fun chats() {
        val model = model()
        shot("chats") { SignedIn(model, startTab = 1) }
    }

    @Test fun ownProfile() {
        val model = model()
        shot("profile_own") { SignedIn(model, startTab = 2) }
    }

    @Test fun otherProfile() {
        val model = model()
        val feed = FeedState(model.api, CoroutineScope(SupervisorJob())).apply { show(samplePosts.take(2)) }
        val person = JSONObject(seedy.toString()).put("bio", "Делаю Noctgram. Пишу про серверы и про то, почему всё сломалось в 3 ночи.")
            .put("cover", "").put("followers", 5210).put("following", 48).put("postCount", 312).put("created", now - 900L * 24 * 60 * minute)
            .put("handles", JSONArray(listOf("root", "seedy"))).put("lastSeen", now - 30 * minute).put("followed", 0)
        shot("profile_other") { ProfileContent(model, person, feed, own = false, onBack = {}, error = "", reload = {}) }
    }

    @Test fun chat() {
        val model = model()
        val state = ChatState().apply {
            val day = 24 * 60 * minute
            messages = listOf(
                JSONObject().put("id", "m1").put("sender", "seedy").put("text", "Привет! Видел новую обложку профиля, выглядит круто").put("created", now - day - 40 * minute),
                JSONObject().put("id", "m2").put("sender", "me").put("text", "Спасибо! Это «Жидкое», строится из аватарки").put("created", now - day - 38 * minute).put("read", 1),
                JSONObject().put("id", "m3").put("sender", "me").put("text", "Могу скинуть исходник").put("created", now - day - 37 * minute).put("read", 1),
                JSONObject().put("id", "m4").put("sender", "seedy").put("text", "Давай, и заодно скрин с телефона").put("created", now - 20 * minute)
                    .put("reply", JSONObject().put("name", "Мира Лунная").put("text", "Могу скинуть исходник")),
                JSONObject().put("id", "m5").put("sender", "me").put("text", "").put("created", now - 8 * minute).put("read", 1)
                    .put("attachments", JSONArray().put(JSONObject().put("id", "city").put("kind", "image"))),
                JSONObject().put("id", "m6").put("sender", "me").put("text", "Вот так он выглядит на экране").put("created", now - 8 * minute).put("read", 0),
                JSONObject().put("id", "m7").put("sender", "seedy").put("text", "Скинь потом исходник обложки?").put("created", now - 4 * minute),
            )
        }
        shot("chat") {
            ChatContent(model, Screen.Chat("seedy", "Seedy", "/api/media/seedy", room = false), state, draft = "", onDraft = {}, onAttach = {}, onRemove = {}, onSend = {})
        }
    }

    @Test fun comments() {
        val model = model()
        val state = CommentsState().apply {
            loading = false
            comments = listOf(
                JSONObject(seedy.toString()).put("id", "c1").put("userId", "seedy").put("text", "Какая камера? Огни получились очень мягкие.").put("created", now - 50 * minute),
                JSONObject().put("id", "c2").put("userId", "lena").put("name", "Лена Сон").put("avatar", "/api/media/lena").put("premium", 1).put("profileTheme", "rose").put("nameGradient", 1)
                    .put("text", "Сохранила себе, очень атмосферно").put("created", now - 12 * minute),
            )
        }
        shot("comments") { CommentsContent(model, samplePosts[0], state, draft = "Телефон, ночной режим", onDraft = {}, onOlder = {}, onSend = {}) }
    }

    @Test fun composer() {
        val model = model()
        shot("composer") { ComposerScreen(model) }
    }

    @Test fun editProfile() {
        val model = model()
        shot("edit_profile") { EditProfileScreen(model) }
    }

    @Test fun design() {
        val model = model()
        shot("design") { DesignScreen(model) }
    }

    private fun adminState() = AdminState().apply {
        loading = false
        people = listOf(
            JSONObject(seedy.toString()).put("administrator", 1).put("balance", 1_250_000),
            JSONObject().put("id", "lena").put("name", "Лена Сон").put("handle", "lenason").put("avatar", "/api/media/lena")
                .put("premium", 1).put("profileTheme", "rose").put("nameGradient", 1).put("moderator", 1).put("balance", 48_200),
            JSONObject().put("id", "dev").put("name", "Дима Кодов").put("handle", "dimacode").put("avatar", "/api/media/dev").put("balance", 3_100),
            JSONObject().put("id", "news").put("name", "Noctgram | Новости").put("handle", "news").put("avatar", "/api/media/me").put("kind", "channel"),
        )
        events = listOf(
            JSONObject().put("id", "e1").put("action", "stars").put("amount", 5000).put("reason", "Награда за помощь в тестировании")
                .put("created", now - 3 * 60 * minute).put("actorName", "Seedy").put("handle", "lenason"),
            JSONObject().put("id", "e2").put("action", "collectible").put("amount", 2).put("reason", "Команда разработки")
                .put("created", now - 26 * 60 * minute).put("actorName", "Seedy").put("handle", "dimacode")
                .put("payload", JSONObject().put("giftId", "plush_pepe").put("firstNumber", 101).put("count", 2)
                    .put("attributes", JSONObject().put("model", JSONObject().put("name", "Neon")).put("backdrop", JSONObject().put("name", "Midnight Blue")).put("symbol", JSONObject().put("name", "Moon"))).toString()),
            JSONObject().put("id", "e3").put("action", "marketIssue").put("amount", 12).put("reason", "Первый выпуск красивых номеров")
                .put("created", now - 50 * 60 * minute).put("actorName", "Seedy"),
        )
    }

    @Test fun admin() {
        val model = model()
        shot("admin") { AdminContent(model, adminState(), onMore = {}) }
    }

    @Test fun adminGrant() {
        val model = model()
        val state = adminState().apply { selected = people[1] }
        shot("admin_grant") { AdminContent(model, state, onMore = {}) }
    }

    @Test fun support() {
        val model = model()
        shot("support") { SupportPreview(model, samplePosts[0].put("mySupport", 400), balance = 1_250, amount = 100) }
    }

    @Test fun designCustom() {
        val model = model()
        model.preview(
            JSONObject(account.toString()).put("profileTheme", "rose").put("ringText", "в своей орбите")
                .put("profileBackground", JSONObject().put("mode", "custom").put("first", "#e05a8a").put("second", "#426b98").put("intensity", 34).put("musicColor", "profile").toString()),
        )
        shot("design_custom") { DesignScreen(model) }
    }

    @Test fun colorPicker() {
        shot("color_picker") {
            Box(Modifier.padding(20.dp)) { ColorPicker(androidx.compose.ui.graphics.Color(0xFFE05A8A), "Первый цвет", onPick = {}, onDismiss = {}) }
        }
    }

    @Test fun login() {
        val model = model()
        shot("login") { LoginScreen(model) }
    }
}
