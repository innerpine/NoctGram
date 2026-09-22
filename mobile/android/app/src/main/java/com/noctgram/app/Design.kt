package com.noctgram.app

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.text.BreakIterator
import kotlin.math.roundToInt

private val MotionTypes = setOf("image/gif", "video/mp4", "video/webm")
private val Hex = Regex("^#[0-9a-fA-F]{6}$")

/** The site counts the ring text in visible characters (graphemes) and allows 48. */
private fun graphemes(text: String): List<String> {
    val iterator = BreakIterator.getCharacterInstance().apply { setText(text) }
    val out = ArrayList<String>()
    var start = iterator.first()
    var end = iterator.next()
    while (end != BreakIterator.DONE) {
        out += text.substring(start, end)
        start = end
        end = iterator.next()
    }
    return out
}

@Composable
private fun Setting(title: String, text: String, checked: Boolean, enabled: Boolean = true, onChange: (Boolean) -> Unit) = Row(
    Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(12.dp),
) {
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(title, fontSize = 15.sp, fontWeight = FontWeight.Medium)
        Text(text, color = Muted, fontSize = 13.sp, lineHeight = 18.sp)
    }
    Switch(checked, onChange, enabled = enabled, colors = noctSwitchColors())
}

@Composable
private fun Section(icon: ImageVector, title: String, tag: String? = null, content: @Composable () -> Unit) = Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(icon, contentDescription = null, tint = Secondary, modifier = Modifier.size(17.dp))
        Text(title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.2).sp)
        tag?.let {
            Text(
                it, color = Accent, fontSize = 11.sp, fontWeight = FontWeight.Medium,
                modifier = Modifier.clip(CircleShape).background(Accent.copy(alpha = 0.12f)).padding(horizontal = 8.dp, vertical = 2.dp),
            )
        }
    }
    content()
}

/** Profile design: everything the site's «Дизайн» tab offers, with a live preview. Saving needs Noct Premium. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun DesignScreen(model: AppModel) {
    val me = model.me ?: return
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val premium = me.optInt("premium") != 0
    val saved = remember { runCatching { JSONObject(me.optString("profileBackground")) }.getOrNull() }
    var theme by rememberSaveable { mutableStateOf(me.optString("profileTheme").ifEmpty { "iris" }) }
    var gradient by rememberSaveable { mutableStateOf(me.optInt("nameGradient") != 0) }
    var ring by rememberSaveable { mutableStateOf(me.optString("ringText")) }
    var chrome by rememberSaveable { mutableStateOf(me.optInt("chromeFlow") != 0) }
    var tempo by rememberSaveable { mutableIntStateOf(me.optInt("chromeTempo", 11).coerceIn(3, 26)) }
    var mode by rememberSaveable { mutableStateOf(saved?.optString("mode")?.takeIf { it in listOf("none", "theme", "cover", "custom") } ?: "none") }
    var first by rememberSaveable { mutableStateOf(saved?.optString("first")?.takeIf { Hex.matches(it) } ?: "#9775cf") }
    var second by rememberSaveable { mutableStateOf(saved?.optString("second")?.takeIf { Hex.matches(it) } ?: "#426b98") }
    var intensity by rememberSaveable { mutableIntStateOf((saved?.optInt("intensity", 30) ?: 30).coerceIn(15, 40)) }
    var music by rememberSaveable { mutableStateOf(saved?.optString("musicColor")?.takeIf { it == "profile" || it == "cover" } ?: "cover") }
    var motion by rememberSaveable { mutableStateOf(me.optString("avatarMotion")) }
    var motionType by rememberSaveable { mutableStateOf(me.optString("avatarMotionType")) }
    var poster by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var picking by remember { mutableStateOf<String?>(null) }

    val background = JSONObject().put("mode", mode).put("first", first.lowercase()).put("second", second.lowercase())
        .put("intensity", intensity).put("musicColor", music)
    // What the choices look like before saving: the same record with the new fields on top, shown as with Premium.
    val preview = JSONObject(me.toString()).put("premium", 1).put("profileTheme", theme).put("nameGradient", if (gradient) 1 else 0)
        .put("ringText", ring).put("chromeFlow", if (chrome) 1 else 0).put("chromeTempo", tempo)
        .put("profileBackground", background.toString()).put("avatarMotion", motion).put("avatarMotionType", motionType)
        .apply { if (poster.isNotEmpty()) put("avatar", poster) }

    val animation = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) scope.launch {
            busy = true
            error = ""
            try {
                val file = withContext(Dispatchers.IO) { readPicked(context, uri) }
                    ?: throw ApiException(0, "UNREADABLE", "Не удалось прочитать файл или он больше 25 МБ.")
                if (file.mime !in MotionTypes || file.bytes.size > 10 * 1024 * 1024)
                    throw ApiException(0, "MOTION", "Выбери GIF, MP4 или WebM до 10 МБ")
                // The site keeps a still first frame next to the animation, for lists and reduced motion.
                val still = withContext(Dispatchers.IO) { posterOf(context, file) }
                    ?: throw ApiException(0, "POSTER", "Не удалось взять первый кадр. Попробуй другой файл.")
                val media = model.api.upload(file.bytes, file.name, file.mime).getString("id")
                val frame = model.api.upload(still, "poster.jpg", "image/jpeg").getString("id")
                motion = "/api/media/$media"
                motionType = file.mime
                poster = "/api/media/$frame"
            } catch (failure: ApiException) { error = failure.message.orEmpty() }
            busy = false
        }
    }

    fun save() {
        busy = true
        error = ""
        scope.launch {
            try {
                val profile = model.api.post(
                    "/api/social",
                    JSONObject().put("action", "appearance").put("theme", theme).put("nameGradient", gradient)
                        .put("ringText", ring).put("chromeFlow", chrome).put("chromeTempo", tempo)
                        .put("avatarMotion", motion).put("poster", poster).put("background", background),
                )
                model.updated(profile)
                model.back()
            } catch (failure: ApiException) {
                error = failure.message.orEmpty()
                busy = false
            }
        }
    }

    Column(Modifier.fillMaxSize().imePadding().navigationBarsPadding()) {
        TopBar("Дизайн профиля", model::back) {
            if (premium) NoctButton(if (busy) "Сохраняем…" else "Сохранить", ::save, enabled = !busy, compact = true)
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(24.dp)) {
            DesignPreview(model, preview)
            if (!premium) Row(
                Modifier.fillMaxWidth().noctCard(RoundedCornerShape(14.dp), border = themeColors(theme).first.copy(alpha = 0.3f)).padding(14.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                PremiumBadge(Look(preview), 24.dp)
                Text("Примеряй оформление. Для сохранения и анимированного аватара нужен Noct Premium.", color = Body, fontSize = 13.sp, lineHeight = 19.sp)
            }
            Section(Lucide.Palette, "Цвет профиля") {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    for ((id, label) in ThemeNames) Column(
                        Modifier.clip(RoundedCornerShape(12.dp)).clickable { theme = id }.padding(2.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        val (a, b) = themeColors(id)
                        Box(Modifier.size(44.dp).clip(CircleShape).background(Brush.linearGradient(listOf(a, b))), Alignment.Center) {
                            if (theme == id) Icon(Lucide.Check, contentDescription = "Выбрано", tint = Background, modifier = Modifier.size(18.dp))
                        }
                        Text(label, color = if (theme == id) Foreground else Muted, fontSize = 11.sp, fontWeight = if (theme == id) FontWeight.Medium else FontWeight.Normal)
                    }
                }
            }
            Section(Lucide.Palette, "Фон профиля", tag = "Noct Premium") {
                Text("Градиент всей карточки — под твоё оформление, баннер или любимые цвета.", color = Muted, fontSize = 13.sp, lineHeight = 18.sp)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    for ((id, label) in listOf("none" to "Без фона", "theme" to "Цвет оформления", "cover" to "Баннер и аватар", "custom" to "Своя палитра"))
                        Chip(label, mode == id) { mode = id }
                }
                if (mode == "cover") Text("Берём цвета баннера. Если его нет — аватарки.", color = Muted, fontSize = 13.sp)
                if (mode == "custom") {
                    ColorRow("Первый цвет", first) { picking = "first" }
                    ColorRow("Второй цвет", second) { picking = "second" }
                }
                if (mode != "none") Column {
                    Row {
                        Text("Интенсивность", color = Secondary, fontSize = 13.sp, modifier = Modifier.weight(1f))
                        Text("$intensity %", fontSize = 13.sp, fontWeight = FontWeight.Medium)
                    }
                    ThinSlider(intensity.toFloat(), { intensity = it.roundToInt() }, 15f..40f)
                }
            }
            Section(Lucide.Headphones, "Статус музыки") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Chip("Цвет профиля", music == "profile") { music = "profile" }
                    Chip("Цвет обложки", music == "cover") { music = "cover" }
                }
                Text(
                    if (music == "profile") "Фон и акценты карточки — в выбранной палитре профиля." else "Фон и акценты карточки меняются под обложку песни.",
                    color = Muted, fontSize = 13.sp, lineHeight = 18.sp,
                )
            }
            Column(Modifier.fillMaxWidth().noctCard()) {
                Setting("Градиентный ник", "Цвет имени и значка — в одной палитре.", gradient) { gradient = it }
                HairlineDivider()
                Setting("Chrome Flow", "Металлический блик в цветах профиля.", chrome) { chrome = it }
                if (chrome) Column(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 14.dp)) {
                    Row {
                        Text("Темп переливания", color = Secondary, fontSize = 13.sp, modifier = Modifier.weight(1f))
                        Text(
                            "%.2f".format(java.util.Locale("ru"), 11f / tempo).trimEnd('0').trimEnd(',') + "×",
                            fontSize = 13.sp, fontWeight = FontWeight.Medium,
                        )
                    }
                    // Right is faster: the slider runs opposite to the seconds a turn takes, as on the site.
                    ThinSlider((29 - tempo).toFloat(), { tempo = 29 - it.roundToInt() }, 3f..26f)
                    Row {
                        Text("Спокойнее", color = Muted, fontSize = 11.sp, modifier = Modifier.weight(1f))
                        Text("Быстрее", color = Muted, fontSize = 11.sp)
                    }
                }
            }
            NoctField(
                ring, { ring = graphemes(it).take(48).joinToString("") },
                label = "Текст вокруг аватара · ${graphemes(ring).size}/48",
                placeholder = "В своей орбите",
                hint = "Оставь пустым, чтобы убрать обводку.",
                singleLine = true,
            )
            Section(Lucide.Film, "Анимированный аватар") {
                Text("GIF, MP4 или WebM до 10 МБ. Изображение обрезается по центру в круг.", color = Muted, fontSize = 13.sp, lineHeight = 18.sp)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    NoctButton(
                        if (busy) "Загружаем…" else if (motion.isNotEmpty()) "Заменить анимацию" else "Выбрать файл",
                        { animation.launch(arrayOf("image/gif", "video/mp4", "video/webm")) },
                        tone = Tone.Secondary, icon = Lucide.Film, enabled = premium && !busy,
                    )
                    if (motion.isNotEmpty()) NoctButton("Убрать", {
                        motion = ""
                        motionType = ""
                        poster = ""
                    }, tone = Tone.Secondary, enabled = !busy)
                }
            }
            if (error.isNotEmpty()) ErrorNote(error)
            if (premium) NoctButton(if (busy) "Сохраняем…" else "Сохранить оформление", ::save, Modifier.fillMaxWidth(), enabled = !busy)
            else Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                NoctButton("Открыть Noct Premium", {
                    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(NoctApi.ORIGIN))) }
                }, Modifier.fillMaxWidth(), icon = Lucide.ExternalLink)
                Text("Premium оформляется на noctgram.com, после этого оформление сохраняется и здесь.", color = Muted, fontSize = 12.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
            }
            Column(Modifier.fillMaxWidth().noctCard()) {
                Setting(
                    "Анимации аватаров и обводок",
                    if (MotionPreference.systemReduced) "Выключены в настройках телефона: там убраны анимации." else "На этом устройстве. Учитывает настройки уменьшения движения.",
                    MotionPreference.enabled,
                    enabled = !MotionPreference.systemReduced,
                ) { MotionPreference.choose(context, it) }
            }
            Spacer(Modifier.height(8.dp))
        }
    }
    picking?.let { which ->
        ColorPickerDialog(
            parseHex(if (which == "first") first else second),
            if (which == "first") "Первый цвет" else "Второй цвет",
            onPick = {
                if (which == "first") first = it.hex() else second = it.hex()
                picking = null
            },
            onDismiss = { picking = null },
        )
    }
}

/** The site's design preview: the avatar with its decorations, the name, the handle and the bio on the chosen surface. */
@Composable
internal fun DesignPreview(model: AppModel, person: JSONObject) {
    val look = Look(person)
    val surface = profileSurface(person)
    val shape = RoundedCornerShape(18.dp)
    val ground = surface?.let { Brush.linearGradient(it) }
        ?: Brush.verticalGradient(listOf(lerp(Color(0xFF111114), look.wash, 0.3f), Color(0xFF111114)))
    Box(Modifier.fillMaxWidth().clip(shape).background(ground).border(1.dp, lerp(Color(0xFF28282D), look.first, 0.25f), shape)) {
        Text(
            "Предпросмотр", color = Color(0xFFA3A0AC), fontSize = 10.sp, letterSpacing = 0.5.sp,
            modifier = Modifier.align(Alignment.TopEnd).padding(top = 12.dp, end = 14.dp),
        )
        Column(Modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, top = 34.dp, bottom = 22.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            ProfileAvatar(model.api, person, 80.dp, surface?.first() ?: Color(0xFF111114))
            DisplayName(person, fontSize = 23.sp, modifier = Modifier.padding(top = 10.dp))
            Text("@" + person.optString("handle"), color = Color(0xFFA6A3AD), fontSize = 13.sp, modifier = Modifier.padding(top = 2.dp))
            Text(
                person.optString("bio").ifBlank { "Твоё маленькое пространство большой ночи." },
                color = Color(0xFFA6A3AD), fontSize = 12.sp, lineHeight = 17.sp, textAlign = TextAlign.Center,
                maxLines = 3, modifier = Modifier.padding(top = 12.dp),
            )
        }
    }
}

@Composable
private fun ColorRow(label: String, hex: String, onClick: () -> Unit) = Row(
    Modifier.fillMaxWidth().noctCard(RoundedCornerShape(14.dp)).clickable(onClick = onClick).padding(12.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(12.dp),
) {
    Box(Modifier.size(36.dp).clip(RoundedCornerShape(10.dp)).background(parseHex(hex)).border(1.dp, Border, RoundedCornerShape(10.dp)))
    Column(Modifier.weight(1f)) {
        Text(label, fontSize = 14.sp, fontWeight = FontWeight.Medium)
        Text(hex.uppercase(), color = Muted, fontSize = 12.sp, fontFamily = FontFamily.Monospace)
    }
    Icon(Lucide.ChevronRight, contentDescription = null, tint = Muted, modifier = Modifier.size(16.dp))
}

private fun hsv(hue: Float, saturation: Float, value: Float) = Color(android.graphics.Color.HSVToColor(floatArrayOf(hue, saturation, value)))

private val Presets = listOf("#9775cf", "#426b98", "#c9a9ff", "#84ceff", "#87e7d6", "#3ecf8e", "#ffc88c", "#ff8a65", "#ffa8cb", "#e05a8a", "#fafaff", "#5b5f73")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ColorSlider(label: String, value: Float, track: Brush, onChange: (Float) -> Unit) = Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
    Text(label, color = Muted, fontSize = 12.sp)
    Slider(
        value, onChange, valueRange = 0f..1f,
        thumb = { Box(Modifier.size(24.dp).clip(CircleShape).background(Color.White).border(3.dp, Color(0x40000000), CircleShape)) },
        track = { Box(Modifier.fillMaxWidth().height(12.dp).clip(CircleShape).background(track)) },
    )
}

/** A colour, chosen like the site's <input type="color">: hue, saturation, brightness or a hex code. */
@Composable
fun ColorPickerDialog(initial: Color, title: String, onPick: (Color) -> Unit, onDismiss: () -> Unit) =
    Dialog(onDismissRequest = onDismiss) { ColorPicker(initial, title, onPick, onDismiss) }

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun ColorPicker(initial: Color, title: String, onPick: (Color) -> Unit, onDismiss: () -> Unit) {
    val start = remember { FloatArray(3).also { android.graphics.Color.colorToHSV(initial.toArgb(), it) } }
    var hue by remember { mutableFloatStateOf(start[0]) }
    var saturation by remember { mutableFloatStateOf(start[1]) }
    var brightness by remember { mutableFloatStateOf(start[2]) }
    var typed by remember { mutableStateOf(initial.hex()) }
    val color = hsv(hue, saturation, brightness)
    fun set(value: Color) {
        val parts = FloatArray(3)
        android.graphics.Color.colorToHSV(value.toArgb(), parts)
        hue = parts[0]
        saturation = parts[1]
        brightness = parts[2]
    }
    run {
        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(Popover).border(1.dp, Hairline, RoundedCornerShape(24.dp)).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text(title, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
            Box(Modifier.fillMaxWidth().height(64.dp).clip(RoundedCornerShape(16.dp)).background(color).border(1.dp, Border, RoundedCornerShape(16.dp)))
            ColorSlider("Оттенок", hue / 360f, Brush.horizontalGradient((0..6).map { hsv(it * 60f, 1f, 1f) })) {
                hue = it * 360f
                typed = hsv(hue, saturation, brightness).hex()
            }
            ColorSlider("Насыщенность", saturation, Brush.horizontalGradient(listOf(hsv(hue, 0f, brightness), hsv(hue, 1f, brightness)))) {
                saturation = it
                typed = hsv(hue, saturation, brightness).hex()
            }
            ColorSlider("Яркость", brightness, Brush.horizontalGradient(listOf(Color.Black, hsv(hue, saturation, 1f)))) {
                brightness = it
                typed = hsv(hue, saturation, brightness).hex()
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                for (preset in Presets) Box(
                    Modifier.size(30.dp).clip(CircleShape).background(parseHex(preset))
                        .border(if (typed.equals(preset, true)) 2.dp else 1.dp, if (typed.equals(preset, true)) Foreground else Border, CircleShape)
                        .clickable {
                            set(parseHex(preset))
                            typed = preset
                        },
                )
            }
            NoctField(
                typed,
                { value ->
                    typed = value.trim().take(7)
                    // A complete code moves the sliders; an unfinished one waits.
                    if (Hex.matches(typed)) set(parseHex(typed))
                },
                label = "Код цвета",
                placeholder = "#9775cf",
                singleLine = true,
            )
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
                NoctButton("Отмена", onDismiss, tone = Tone.Quiet)
                NoctButton("Готово", { onPick(color) })
            }
        }
    }
}
