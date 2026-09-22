package com.noctgram.app

import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
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
import androidx.compose.ui.graphics.Color
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
private fun SectionTitle(text: String, modifier: Modifier = Modifier) =
    Text(text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.2).sp, modifier = modifier)

@Composable
private fun Setting(title: String, text: String, checked: Boolean, enabled: Boolean, onChange: (Boolean) -> Unit) = Row(
    Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(12.dp),
) {
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(title, fontSize = 15.sp, fontWeight = FontWeight.Medium)
        Text(text, color = Muted, fontSize = 13.sp)
    }
    Switch(checked, onChange, enabled = enabled, colors = noctSwitchColors())
}

/** A thin white track with a round thumb, instead of Material's tall bar. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NoctSlider(value: Float, onChange: (Float) -> Unit, range: ClosedFloatingPointRange<Float>, enabled: Boolean) {
    val colors = SliderDefaults.colors(
        thumbColor = Foreground,
        activeTrackColor = Foreground,
        inactiveTrackColor = Fill10,
        disabledThumbColor = Muted,
        disabledActiveTrackColor = Muted,
        disabledInactiveTrackColor = Fill6,
    )
    Slider(
        value, onChange, valueRange = range, enabled = enabled, colors = colors,
        thumb = { Box(Modifier.size(22.dp).clip(CircleShape).background(if (enabled) Foreground else Muted)) },
        track = { state ->
            SliderDefaults.Track(
                state, Modifier.height(4.dp), enabled = enabled, colors = colors,
                drawStopIndicator = null, thumbTrackGapSize = 0.dp,
            )
        },
    )
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
        TopBar("Редактирование", model::back) {
            NoctButton(if (busy) "Сохраняем…" else "Сохранить", enabled = !busy && name.isNotBlank(), compact = true, onClick = {
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
            })
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            Column(Modifier.fillMaxWidth().noctCard(RoundedCornerShape(20.dp))) {
                Box(Modifier.fillMaxWidth().height(130.dp).background(Cover)) {
                    when {
                        cover == "liquid" && avatar.isNotEmpty() && Build.VERSION.SDK_INT >= 31 ->
                            NetImage(model.api, avatar, Modifier.fillMaxSize().blur(48.dp), maxSide = 256)
                        cover.startsWith("/api/") -> NetImage(model.api, cover, Modifier.fillMaxSize())
                    }
                    IconAction(
                        Lucide.Camera, "Сменить обложку", tint = Foreground, size = 36.dp, iconSize = 17.dp,
                        background = Background.copy(alpha = 0.6f), modifier = Modifier.align(Alignment.TopEnd).padding(10.dp),
                    ) { pick("cover") }
                }
                Box(Modifier.padding(horizontal = 16.dp).overlapUp(44.dp).padding(bottom = 16.dp)) {
                    Box(Modifier.size(88.dp).clip(CircleShape).background(Card).padding(5.dp).clip(CircleShape).clickable { pick("avatar") }) {
                        Avatar(model.api, avatar, name, 78.dp)
                    }
                    Box(
                        Modifier.align(Alignment.BottomEnd).size(28.dp).clip(CircleShape).background(Foreground).border(2.dp, Card, CircleShape)
                            .clickable { pick("avatar") },
                        contentAlignment = Alignment.Center,
                    ) { Icon(Lucide.Camera, contentDescription = "Сменить аватар", tint = Background, modifier = Modifier.size(14.dp)) }
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                SectionTitle("Обложка")
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Chip("Картинка", cover.startsWith("/api/"), icon = Lucide.Image) { pick("cover") }
                    // «Жидкое»: the banner the site draws from the avatar's colours.
                    Chip("Жидкое", cover == "liquid", icon = Lucide.Sparkles) { cover = "liquid" }
                    Chip("Без обложки", cover.isEmpty()) { cover = "" }
                }
                if (cover == "liquid" && avatar.isEmpty()) Text("«Жидкое» строится из цветов аватарки. Добавьте её, и фон появится.", color = Muted, fontSize = 13.sp)
            }
            NoctField(name, { name = it.take(40) }, label = "Имя", placeholder = "Как вас зовут", singleLine = true)
            NoctField(bio, { bio = it.take(300) }, label = "О себе", placeholder = "Расскажите о себе — пусть свои вас узнают.", minLines = 3, hint = "${bio.length} из 300")
            Row(
                Modifier.fillMaxWidth().noctCard(RoundedCornerShape(14.dp)).padding(14.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Lucide.Link, contentDescription = null, tint = Secondary, modifier = Modifier.size(17.dp))
                Text("Юзернеймы и анонимный номер меняются на noctgram.com.", color = Secondary, fontSize = 13.sp, lineHeight = 18.sp)
            }
            if (error.isNotEmpty()) ErrorNote(error)
            Spacer(Modifier.height(6.dp))
            NoctButton("Выйти из аккаунта", { model.signOut() }, Modifier.fillMaxWidth(), tone = Tone.Danger, icon = Lucide.LogOut)
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
            NoctButton(if (busy) "Сохраняем…" else "Сохранить", enabled = premium && !busy, compact = true, onClick = {
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
            })
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            if (!premium) Row(
                Modifier.fillMaxWidth().noctCard(RoundedCornerShape(14.dp), border = colors.first.copy(alpha = 0.3f)).padding(14.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                GradientIcon(Lucide.Sparkles, listOf(colors.first, colors.second), 22.dp, null)
                Text("Оформление открывается с Noct Premium. Пока можно посмотреть, как оно будет выглядеть.", color = Body, fontSize = 13.sp, lineHeight = 19.sp)
            }
            val shape = RoundedCornerShape(20.dp)
            Column(
                Modifier.fillMaxWidth().clip(shape)
                    .background(if (mode == "none") Brush.linearGradient(listOf(Card, Card)) else Brush.linearGradient(listOf(washed(colors.first, intensity.roundToInt()), washed(colors.second, intensity.roundToInt()))))
                    .border(1.dp, colors.first.copy(alpha = 0.25f), shape),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(Modifier.fillMaxWidth().height(64.dp).background(Brush.linearGradient(listOf(washed(colors.first, 38), washed(colors.second, 20)))))
                // Shown as it will be with Premium, even when the account has none yet.
                val shown = JSONObject(preview.toString()).put("premium", 1)
                Box(Modifier.overlapUp(48.dp)) { ProfileAvatar(model.api, shown, 80.dp, if (mode == "none") Card else washed(colors.first, intensity.roundToInt())) }
                DisplayName(shown, fontSize = 22.sp, modifier = Modifier.padding(horizontal = 20.dp))
                Text("@" + me.optString("handle"), color = colors.first, fontSize = 14.sp, modifier = Modifier.padding(top = 3.dp, bottom = 18.dp))
            }
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                SectionTitle("Палитра")
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    for ((id, label) in ThemeNames) Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        val pair = themeColors(id)
                        val chosen = theme == id
                        Box(
                            Modifier.size(48.dp).clip(CircleShape).border(2.dp, if (chosen) Foreground else Color.Transparent, CircleShape)
                                .clickable { theme = id }.padding(5.dp).clip(CircleShape)
                                .background(Brush.linearGradient(listOf(pair.first, pair.second))),
                        )
                        Text(label, color = if (chosen) Foreground else Muted, fontSize = 11.sp, fontWeight = if (chosen) FontWeight.Medium else FontWeight.Normal)
                    }
                }
            }
            Column(Modifier.fillMaxWidth().noctCard(RoundedCornerShape(16.dp))) {
                Setting("Градиент имени", "Имя переливается цветами палитры", gradient, premium) { gradient = it }
                HairlineDivider()
                Setting("Chrome Flow", "Металлический ободок вокруг аватара", chrome, premium) { chrome = it }
                if (chrome) Column(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 10.dp)) {
                    Text("Один оборот за ${tempo.roundToInt()} с", color = Muted, fontSize = 13.sp)
                    NoctSlider(tempo, { tempo = it }, 3f..26f, premium)
                }
            }
            NoctField(
                ring, { ring = it.take(48) },
                label = "Текст вокруг аватара",
                placeholder = "Например, NOCTGRAM",
                hint = "До 48 символов. Пусто — без обводки.",
                singleLine = true,
                enabled = premium,
            )
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                SectionTitle("Фон карточки профиля")
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Chip("Нет", mode == "none") { mode = "none" }
                    Chip("По палитре", mode == "theme") { mode = "theme" }
                    Chip("По обложке", mode == "cover") { mode = "cover" }
                    // Own colours are chosen on the site; here they can only be kept.
                    if (saved?.optString("mode") == "custom") Chip("Свои цвета", mode == "custom") { mode = "custom" }
                }
                if (mode != "none") Column {
                    Text("Насыщенность ${intensity.roundToInt()} %", color = Muted, fontSize = 13.sp)
                    NoctSlider(intensity, { intensity = it }, 15f..40f, premium)
                }
            }
            if (error.isNotEmpty()) ErrorNote(error)
        }
    }
}
