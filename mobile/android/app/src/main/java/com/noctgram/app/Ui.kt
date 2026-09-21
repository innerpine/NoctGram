package com.noctgram.app

import android.content.Context
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.OpenableColumns
import android.util.LruCache
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject

// The Noctgram system from DESIGN.md: dark only, white text in four strengths.
val Background = Color(0xFF000000)
val Card = Color(0xFF0C0C0C)
val Popover = Color(0xFF161616)
val Segment = Color(0xFF242424)
val Foreground = Color(0xFFFFFFFF)
val Body = Color(0xBFFFFFFF)
val Muted = Color(0x7AFFFFFF)
val Hairline = Color(0x14FFFFFF)
val Accent = Color(0xFFAF9ADD)
val Gold = Color(0xFFFFD36A)
val Green = Color(0xFF3ECF8E)
val Danger = Color(0xFFEF4444)

/** Room for the floating tab bar, so the last item of a list can scroll above it. */
val TabBarSpace = 104.dp

@Composable
fun NoctTheme(content: @Composable () -> Unit) = MaterialTheme(
    colorScheme = darkColorScheme(
        primary = Foreground,
        onPrimary = Background,
        background = Background,
        onBackground = Foreground,
        surface = Card,
        onSurface = Foreground,
        onSurfaceVariant = Muted,
        outline = Hairline,
        error = Danger,
    ),
    content = content,
)

// Material's core icon set has no chat, image, code or poll glyphs, and the
// extended set is several megabytes; these are the standard paths.
private fun glyph(path: String) = ImageVector.Builder(defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f)
    .addPath(addPathNodes(path), fill = SolidColor(Color.Black)).build()

object Glyphs {
    val Comment = glyph("M20,2L4,2c-1.1,0 -2,0.9 -2,2v18l4,-4h14c1.1,0 2,-0.9 2,-2L22,4c0,-1.1 -0.9,-2 -2,-2zM20,16L6,16l-2,2L4,4h16v12z")
    val Chats = glyph("M21,6h-2v9L6,15v2c0,0.55 0.45,1 1,1h11l4,4L22,7c0,-0.55 -0.45,-1 -1,-1zM17,12L17,3c0,-0.55 -0.45,-1 -1,-1L3,2c-0.55,0 -1,0.45 -1,1v14l4,-4h10c0.55,0 1,-0.45 1,-1z")
    val Photo = glyph("M21,19V5c0,-1.1 -0.9,-2 -2,-2H5c-1.1,0 -2,0.9 -2,2v14c0,1.1 0.9,2 2,2h14c1.1,0 2,-0.9 2,-2zM8.5,13.5l2.5,3.01L14.5,12l4.5,6H5l3.5,-4.5z")
    val Code = glyph("M9.4,16.6L4.8,12l4.6,-4.6L8,6l-6,6 6,6 1.4,-1.4zM14.6,16.6l4.6,-4.6 -4.6,-4.6L16,6l6,6 -6,6 -1.4,-1.4z")
    val Poll = glyph("M19,3L5,3c-1.1,0 -2,0.9 -2,2v14c0,1.1 0.9,2 2,2h14c1.1,0 2,-0.9 2,-2L21,5c0,-1.1 -0.9,-2 -2,-2zM9,17L7,17v-7h2v7zM13,17h-2L11,7h2v10zM17,17h-2v-4h2v4z")
    val Feed = glyph("M10,20v-6h4v6h5v-8h3L12,3 2,12h3v8z")
}

/** The white pill that is the one primary action on a screen. */
@Composable
fun PrimaryButton(text: String, enabled: Boolean = true, modifier: Modifier = Modifier, onClick: () -> Unit) = Button(
    onClick = onClick,
    enabled = enabled,
    modifier = modifier,
    colors = ButtonDefaults.buttonColors(containerColor = Foreground, contentColor = Background),
) { Text(text, fontWeight = FontWeight.Medium) }

@Composable
fun SecondaryButton(text: String, enabled: Boolean = true, modifier: Modifier = Modifier, onClick: () -> Unit) = Button(
    onClick = onClick,
    enabled = enabled,
    modifier = modifier,
    colors = ButtonDefaults.buttonColors(containerColor = Segment, contentColor = Foreground),
) { Text(text, fontWeight = FontWeight.Medium) }

/** Title bar of a screen opened on top of the tabs. */
@Composable
fun TopBar(title: String, onBack: () -> Unit, actions: @Composable () -> Unit = {}) = Row(
    Modifier.fillMaxWidth().background(Background).statusBarsPadding().height(56.dp).padding(horizontal = 4.dp),
    verticalAlignment = Alignment.CenterVertically,
) {
    Icon(
        Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Назад", tint = Foreground,
        modifier = Modifier.clip(CircleShape).clickable(onClick = onBack).padding(12.dp),
    )
    Text(title, fontSize = 19.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).padding(horizontal = 4.dp))
    actions()
}

@Composable
fun Placeholder(title: String, text: String) = Column(
    Modifier.fillMaxSize().padding(32.dp),
    verticalArrangement = Arrangement.Center,
    horizontalAlignment = Alignment.CenterHorizontally,
) {
    Text(title, fontSize = 21.sp, fontWeight = FontWeight.Medium)
    Text(text, color = Muted, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 8.dp))
}

@Composable
fun FullScreenError(text: String, retry: () -> Unit) = Column(
    Modifier.fillMaxSize().padding(32.dp),
    verticalArrangement = Arrangement.Center,
    horizontalAlignment = Alignment.CenterHorizontally,
) {
    Text("Не удалось загрузить", fontSize = 21.sp, fontWeight = FontWeight.Medium)
    Text(text, color = Muted, textAlign = TextAlign.Center, modifier = Modifier.padding(vertical = 8.dp))
    PrimaryButton("Повторить", onClick = retry)
}

/** "5 мин", "3 ч", "2 д", then a date: the feed's compact timestamps. */
fun relativeTime(created: Long, now: Long = System.currentTimeMillis()): String {
    val minutes = (now - created).coerceAtLeast(0) / 60_000
    return when {
        minutes < 1 -> "сейчас"
        minutes < 60 -> "$minutes мин"
        minutes < 24 * 60 -> "${minutes / 60} ч"
        minutes < 30 * 24 * 60 -> "${minutes / (24 * 60)} д"
        else -> java.text.SimpleDateFormat("d MMM yyyy", java.util.Locale("ru")).format(java.util.Date(created))
    }
}

fun clockTime(created: Long): String = java.text.SimpleDateFormat("HH:mm", java.util.Locale.ROOT).format(java.util.Date(created))

fun groupedNumber(value: Long): String = "%,d".format(java.util.Locale.ROOT, value).replace(',', ' ')

// ---------------------------------------------------------------- appearance

/** The six profile palettes of lib/appearance.ts. */
private val Themes = mapOf(
    "iris" to (Color(0xFFC9A9FF) to Color(0xFF9CCAFF)),
    "aurora" to (Color(0xFF87E7D6) to Color(0xFFBCE8A3)),
    "ocean" to (Color(0xFF84CEFF) to Color(0xFFBAB3FF)),
    "rose" to (Color(0xFFFFA8CB) to Color(0xFFD7B2FF)),
    "ember" to (Color(0xFFFFC88C) to Color(0xFFFFA6B3)),
    "silver" to (Color(0xFFFAFAFF) to Color(0xFFA9B4CB)),
)
val ThemeNames = listOf("iris" to "Ирис", "aurora" to "Сияние", "ocean" to "Океан", "rose" to "Роза", "ember" to "Закат", "silver" to "Лунный")
fun themeColors(name: String) = Themes[name] ?: Themes.getValue("iris")

/**
 * How a person chose to look. The server already blanks these fields for
 * accounts without Premium (or channel boosts), `active` repeats the site's
 * hasProfileDesign() so nothing styled shows for them.
 */
class Look(person: JSONObject) {
    val premium = person.optInt("premium") != 0
    val active = premium || person.optInt("boostLevel") > 0
    val verified = person.optInt("verified") != 0
    val theme = person.optString("profileTheme", "iris")
    val first = themeColors(theme).first
    val second = themeColors(theme).second
    val nameGradient = active && person.optInt("nameGradient") != 0
    val ringText = if (active) person.optString("ringText") else ""
    val chrome = active && person.optInt("chromeFlow") != 0
    val chromeTempo = person.optInt("chromeTempo", 11).coerceIn(3, 26)
    /** Aliases, the anonymous number and similar accents take the profile colour. */
    val accent get() = if (active) first else Body
}

@Composable
fun DisplayName(person: JSONObject, fontSize: TextUnit = 15.sp, modifier: Modifier = Modifier) {
    val look = Look(person)
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
            person.optString("name"),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f, fill = false),
            style = TextStyle(
                fontSize = fontSize,
                fontWeight = FontWeight.Medium,
                letterSpacing = if (fontSize.value > 24) (-1.2).sp else 0.sp,
                brush = if (look.nameGradient) Brush.linearGradient(listOf(look.first, look.second)) else SolidColor(Foreground),
            ),
        )
        val badge = (fontSize.value * 0.9f).dp
        if (look.verified) Icon(Icons.Default.CheckCircle, "Подтверждённый аккаунт", tint = Color(0xFF6CB6FF), modifier = Modifier.size(badge))
        if (look.premium) Icon(Icons.Default.Star, "Noct Premium", tint = look.first, modifier = Modifier.size(badge))
    }
}

// ---------------------------------------------------------------- images

// ponytail: memory-only image cache, stills only (no GIF/video, no disk cache).
// Media needs the session cookie, so it is fetched through NoctApi; switch to Coil
// with an authenticated fetcher when scrolling performance or animation matters.
object ImageCache {
    private val bitmaps = object : LruCache<String, ImageBitmap>(48 * 1024) {
        override fun sizeOf(key: String, value: ImageBitmap) = value.width * value.height * 4 / 1024
    }
    fun get(url: String): ImageBitmap? = bitmaps.get(url)
    fun put(url: String, bitmap: ImageBitmap) { bitmaps.put(url, bitmap) }
    fun clear() = bitmaps.evictAll()
}

private fun decode(bytes: ByteArray, maxSide: Int): ImageBitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSide) sample *= 2
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
        ?.asImageBitmap()
}

/** An image served by NoctGram. Draws a quiet block until it is loaded; failures stay that way. */
@Composable
fun NetImage(
    api: NoctApi,
    url: String,
    modifier: Modifier = Modifier,
    maxSide: Int = 1080,
    contentScale: ContentScale = ContentScale.Crop,
) {
    val bitmap by produceState(ImageCache.get(url), url) {
        if (value == null && url.startsWith("/api/"))
            value = runCatching { decode(api.download(url), maxSide) }.getOrNull()?.also { ImageCache.put(url, it) }
    }
    bitmap?.let { Image(it, contentDescription = null, modifier = modifier, contentScale = contentScale) }
        ?: Box(modifier.background(Segment))
}

@Composable
fun Avatar(api: NoctApi, url: String, name: String, size: Dp, modifier: Modifier = Modifier) = Box(
    modifier.size(size).clip(CircleShape).background(Segment),
    contentAlignment = Alignment.Center,
) {
    if (url.isNotEmpty()) NetImage(api, url, Modifier.fillMaxSize(), maxSide = 256)
    else Text(name.take(2).uppercase(), color = Body, fontSize = (size.value * 0.34f).sp, fontWeight = FontWeight.Medium)
}

/**
 * The large profile avatar with its Premium decorations: the rotating text
 * ring (one turn in 24 s, as on the site) and the Chrome Flow rim.
 */
@Composable
fun ProfileAvatar(api: NoctApi, person: JSONObject, size: Dp) {
    val look = Look(person)
    val ring = look.ringText.isNotBlank()
    val outer = size + if (ring) 40.dp else if (look.chrome) 12.dp else 8.dp
    val turn = rememberInfiniteTransition(label = "avatar")
    Box(Modifier.size(outer), contentAlignment = Alignment.Center) {
        if (look.chrome) {
            val angle by turn.animateFloat(0f, 360f, infiniteRepeatable(tween(look.chromeTempo * 1000, easing = LinearEasing), RepeatMode.Restart), label = "chrome")
            Canvas(Modifier.size(size + 10.dp).rotate(angle)) {
                drawCircle(
                    Brush.sweepGradient(listOf(look.first, Color.White, look.second, Color(0xFF15151A), look.first)),
                    style = Stroke(3.dp.toPx()),
                )
            }
        }
        if (ring) {
            val angle by turn.animateFloat(0f, 360f, infiniteRepeatable(tween(24_000, easing = LinearEasing), RepeatMode.Restart), label = "ring")
            val textSize = with(LocalDensity.current) { 11.sp.toPx() }
            Canvas(Modifier.size(outer).rotate(angle)) {
                val radius = (size.toPx() / 2) + 12.dp.toPx()
                val path = android.graphics.Path().apply { addCircle(center.x, center.y, radius, android.graphics.Path.Direction.CW) }
                val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
                    color = look.first.toArgb()
                    this.textSize = textSize
                    letterSpacing = 0.12f
                }
                drawIntoCanvas { it.nativeCanvas.drawTextOnPath(look.ringText, path, 0f, 0f, paint) }
            }
        }
        Avatar(api, person.optString("avatar"), person.optString("name"), size, Modifier.background(Card, CircleShape).padding(4.dp))
    }
}

/** A person in a list: followers, search results, chat headers. */
@Composable
fun PersonRow(api: NoctApi, person: JSONObject, onClick: () -> Unit, trailing: @Composable () -> Unit = {}) = Row(
    Modifier.fillMaxWidth().clickable(onClick = onClick).padding(16.dp, 10.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(12.dp),
) {
    Avatar(api, person.optString("avatar"), person.optString("name"), 44.dp)
    Column(Modifier.weight(1f)) {
        DisplayName(person)
        Text("@" + person.optString("handle"), color = Muted, fontSize = 13.sp, maxLines = 1)
    }
    trailing()
}

/** `mix(colour, #0b0b10, percent)`: the site's color-mix() for the profile background. */
fun washed(color: Color, percent: Int) = lerp(Color(0xFF0B0B10), color, percent / 100f)

// ---------------------------------------------------------------- picked files

class PickedFile(val name: String, val mime: String, val bytes: ByteArray)

/** Reads a document the system picker returned. Null when it is unreadable or over the 25 MB limit. */
fun readPicked(context: Context, uri: Uri): PickedFile? {
    val resolver = context.contentResolver
    return runCatching { readPicked(resolver, uri) }.getOrNull()
}

private fun readPicked(resolver: android.content.ContentResolver, uri: Uri): PickedFile? {
    val name = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
        if (it.moveToFirst()) it.getString(0) else null
    } ?: "photo.jpg"
    val bytes = resolver.openInputStream(uri)?.use { input ->
        val out = java.io.ByteArrayOutputStream()
        val chunk = ByteArray(64 * 1024)
        while (true) {
            val read = input.read(chunk)
            if (read < 0) break
            if (out.size() + read > NoctApi.MEDIA_LIMIT) return null
            out.write(chunk, 0, read)
        }
        out.toByteArray()
    } ?: return null
    return PickedFile(name, resolver.getType(uri) ?: "image/jpeg", bytes)
}
