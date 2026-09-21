package com.noctgram.app

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import kotlin.math.roundToInt

@Composable
private fun Choice(label: String, active: Boolean, onClick: () -> Unit) = Text(
    label,
    color = if (active) Accent else Body,
    fontSize = 13.sp,
    fontWeight = FontWeight.Medium,
    modifier = Modifier.clip(RoundedCornerShape(50)).background(if (active) Accent.copy(alpha = 0.18f) else Segment)
        .clickable(onClick = onClick).padding(14.dp, 9.dp),
)

@Composable
private fun Setting(title: String, text: String, checked: Boolean, enabled: Boolean, onChange: (Boolean) -> Unit) = Row(
    Modifier.fillMaxWidth(),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(12.dp),
) {
    Column(Modifier.weight(1f)) {
        Text(title, fontWeight = FontWeight.Medium)
        Text(text, color = Muted, fontSize = 13.sp)
    }
    Switch(checked, onChange, enabled = enabled, colors = SwitchDefaults.colors(checkedTrackColor = Accent, checkedThumbColor = Foreground))
}

/** Name, description, avatar and banner. Usernames are edited on the site; leaving them out keeps them untouched. */
@Composable
fun EditProfileScreen(model: AppModel) {
    val me = model.me ?: return
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var name by rememberSaveable { mutableStateOf(me.optString("name")) }
    var bio by rememberSaveable { mutableStateOf(me.optString("bio")) }
    var avatar by rememberSaveable { mutableStateOf(me.optString("avatar")) }
    var cover by rememberSaveable { mutableStateOf(me.optString("cover")) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var target by remember { mutableStateOf("avatar") }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) scope.launch {
            busy = true
            error = ""
            try {
                val file = withContext(Dispatchers.IO) { readPicked(context, uri) }
                    ?: throw ApiException(0, "UNREADABLE", "Не удалось прочитать фото или оно больше 25 МБ.")
                val url = "/api/media/" + model.api.upload(file.bytes, file.name, file.mime).getString("id")
                if (target == "avatar") avatar = url else cover = url
            } catch (failure: ApiException) { error = failure.message.orEmpty() }
            busy = false
        }
    }
    val pick = { what: String ->
        target = what
        picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
    }
    Column(Modifier.fillMaxSize().imePadding().navigationBarsPadding()) {
        TopBar("Профиль", model::back) {
            PrimaryButton(if (busy) "Сохраняем…" else "Сохранить", enabled = !busy && name.isNotBlank(), modifier = Modifier.padding(end = 12.dp)) {
                busy = true
                error = ""
                scope.launch {
                    try {
                        val saved = model.api.post(
                            "/api/social",
                            JSONObject().put("action", "profile").put("id", model.myId).put("name", name.trim()).put("bio", bio.trim())
                                .put("avatar", avatar).put("cover", cover),
                        )
                        model.updated(saved)
                        model.back()
                    } catch (failure: ApiException) {
                        error = failure.message.orEmpty()
                        busy = false
                    }
                }
            }
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Box(Modifier.fillMaxWidth().height(120.dp).clip(RoundedCornerShape(16.dp)).background(Segment)) {
                when {
                    cover == "liquid" && avatar.isNotEmpty() -> NetImage(model.api, avatar, Modifier.fillMaxSize().blur(48.dp), maxSide = 256)
                    cover.startsWith("/api/") -> NetImage(model.api, cover, Modifier.fillMaxSize())
                }
                Avatar(model.api, avatar, name, 72.dp, Modifier.align(Alignment.BottomStart).padding(12.dp).border(3.dp, Card, CircleShape))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Choice("Аватар", false) { pick("avatar") }
                Choice("Обложка", cover.startsWith("/api/")) { pick("cover") }
                // «Жидкое»: the banner the site draws from the avatar's colours.
                Choice("Жидкое", cover == "liquid") { cover = "liquid" }
                if (cover.isNotEmpty()) Choice("Без обложки", false) { cover = "" }
            }
            if (cover == "liquid" && avatar.isEmpty()) Text("«Жидкое» строится из аватарки — добавьте её, и фон появится.", color = Muted, fontSize = 13.sp)
            OutlinedTextField(name, { name = it.take(40) }, label = { Text("Имя") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(bio, { bio = it.take(300) }, label = { Text("О себе") }, minLines = 3, modifier = Modifier.fillMaxWidth())
            Text("Юзернеймы меняются на noctgram.com.", color = Muted, fontSize = 13.sp)
            if (error.isNotEmpty()) Text(error, color = Danger)
            TextButton(onClick = { model.signOut() }) { Text("Выйти из аккаунта", color = Danger) }
        }
    }
}

/** The Premium look of the profile: palette, name gradient, avatar ring and the card's background. */
@Composable
fun DesignScreen(model: AppModel) {
    val me = model.me ?: return
    val scope = rememberCoroutineScope()
    val premium = me.optInt("premium") != 0
    val saved = remember { runCatching { JSONObject(me.optString("profileBackground")) }.getOrNull() }
    var theme by rememberSaveable { mutableStateOf(me.optString("profileTheme", "iris")) }
    var gradient by rememberSaveable { mutableStateOf(me.optInt("nameGradient") != 0) }
    var ring by rememberSaveable { mutableStateOf(me.optString("ringText")) }
    var chrome by rememberSaveable { mutableStateOf(me.optInt("chromeFlow") != 0) }
    var tempo by remember { mutableFloatStateOf(me.optInt("chromeTempo", 11).coerceIn(3, 26).toFloat()) }
    var mode by rememberSaveable { mutableStateOf(saved?.optString("mode")?.ifEmpty { null } ?: "none") }
    var intensity by remember { mutableFloatStateOf((saved?.optInt("intensity", 30) ?: 30).coerceIn(15, 40).toFloat()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    // What the choices look like before saving: the same record with the new fields on top.
    val preview = JSONObject(me.toString())
        .put("profileTheme", theme).put("nameGradient", if (gradient) 1 else 0).put("ringText", ring)
        .put("chromeFlow", if (chrome) 1 else 0).put("chromeTempo", tempo.roundToInt())
    val colors = themeColors(theme)

    Column(Modifier.fillMaxSize().imePadding().navigationBarsPadding()) {
        TopBar("Дизайн профиля", model::back) {
            PrimaryButton(if (busy) "Сохраняем…" else "Сохранить", enabled = premium && !busy, modifier = Modifier.padding(end = 12.dp)) {
                busy = true
                error = ""
                scope.launch {
                    try {
                        val background = JSONObject()
                            .put("mode", mode).put("intensity", intensity.roundToInt())
                            .put("first", saved?.optString("first")?.ifEmpty { null } ?: "#9775cf")
                            .put("second", saved?.optString("second")?.ifEmpty { null } ?: "#426b98")
                            .put("musicColor", saved?.optString("musicColor")?.ifEmpty { null } ?: "cover")
                        val profile = model.api.post(
                            "/api/social",
                            JSONObject().put("action", "appearance").put("theme", theme).put("nameGradient", gradient)
                                .put("ringText", ring.trim()).put("chromeFlow", chrome).put("chromeTempo", tempo.roundToInt())
                                // Sent back unchanged: leaving it out would remove an animated avatar set on the site.
                                .put("avatarMotion", me.optString("avatarMotion"))
                                .put("background", background),
                        )
                        model.updated(profile)
                        model.back()
                    } catch (failure: ApiException) {
                        error = failure.message.orEmpty()
                        busy = false
                    }
                }
            }
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            if (!premium) Text(
                "Оформление профиля открывается с Noct Premium. Сейчас можно только посмотреть, как оно выглядит.",
                color = Body, modifier = Modifier.clip(RoundedCornerShape(14.dp)).background(Segment).padding(14.dp),
            )
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp))
                    .background(if (mode == "none") Brush.linearGradient(listOf(Card, Card)) else Brush.linearGradient(listOf(washed(colors.first, intensity.roundToInt()), washed(colors.second, intensity.roundToInt()))))
                    .border(1.dp, colors.first.copy(alpha = 0.25f), RoundedCornerShape(20.dp)).padding(20.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                // Shown as it will be with Premium, even when the account has none yet.
                val shown = JSONObject(preview.toString()).put("premium", 1)
                ProfileAvatar(model.api, shown, 84.dp)
                DisplayName(shown, fontSize = 23.sp)
                Text("@" + me.optString("handle"), color = colors.first, fontSize = 13.sp)
            }
            Text("Палитра", fontWeight = FontWeight.Medium)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                for ((id, label) in ThemeNames) Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    val pair = themeColors(id)
                    Box(
                        Modifier.size(44.dp).clip(CircleShape).background(Brush.linearGradient(listOf(pair.first, pair.second)))
                            // A zero-width border is a hairline in Compose, so it is added only when chosen.
                            .then(if (theme == id) Modifier.border(3.dp, Foreground, CircleShape) else Modifier).clickable { theme = id },
                    )
                    Text(label, color = if (theme == id) Foreground else Muted, fontSize = 11.sp)
                }
            }
            Setting("Градиент имени", "Имя переливается цветами палитры", gradient, premium) { gradient = it }
            Setting("Chrome Flow", "Металлический ободок вокруг аватара", chrome, premium) { chrome = it }
            if (chrome) Column {
                Text("Темп: ${tempo.roundToInt()} с на оборот", color = Muted, fontSize = 13.sp)
                Slider(tempo, { tempo = it }, valueRange = 3f..26f, enabled = premium, colors = SliderDefaults.colors(thumbColor = Foreground, activeTrackColor = Accent))
            }
            OutlinedTextField(
                ring, { ring = it.take(48) },
                label = { Text("Текст вокруг аватара") },
                supportingText = { Text("До 48 символов. Пусто — без обводки.") },
                singleLine = true,
                enabled = premium,
                modifier = Modifier.fillMaxWidth(),
            )
            Text("Фон карточки профиля", fontWeight = FontWeight.Medium)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Choice("Нет", mode == "none") { mode = "none" }
                Choice("По палитре", mode == "theme") { mode = "theme" }
                Choice("По обложке", mode == "cover") { mode = "cover" }
                // Own colours are chosen on the site; here they can only be kept.
                if (saved?.optString("mode") == "custom") Choice("Свои цвета", mode == "custom") { mode = "custom" }
            }
            if (mode != "none") Column {
                Text("Насыщенность: ${intensity.roundToInt()}%", color = Muted, fontSize = 13.sp)
                Slider(intensity, { intensity = it }, valueRange = 15f..40f, enabled = premium, colors = SliderDefaults.colors(thumbColor = Foreground, activeTrackColor = Accent))
            }
            if (error.isNotEmpty()) Text(error, color = Danger)
        }
    }
}
