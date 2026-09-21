package com.noctgram.app

import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// The Noctgram system from DESIGN.md: dark only, white text in four strengths.
val Background = Color(0xFF000000)
val Card = Color(0xFF0C0C0C)
val Segment = Color(0xFF242424)
val Foreground = Color(0xFFFFFFFF)
val Body = Color(0xBFFFFFFF)
val Muted = Color(0x7AFFFFFF)
val Hairline = Color(0x14FFFFFF)
val Gold = Color(0xFFFFD36A)
val Green = Color(0xFF3ECF8E)
val Danger = Color(0xFFEF4444)

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

/** The white pill that is the one primary action on a screen. */
@Composable
fun PrimaryButton(text: String, enabled: Boolean = true, modifier: Modifier = Modifier, onClick: () -> Unit) = Button(
    onClick = onClick,
    enabled = enabled,
    modifier = modifier,
    colors = ButtonDefaults.buttonColors(containerColor = Foreground, contentColor = Background),
) { Text(text, fontWeight = FontWeight.Medium) }

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

fun groupedNumber(value: Long): String = "%,d".format(java.util.Locale.ROOT, value).replace(',', ' ')

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

/** An image served by NoctGram. Draws nothing until it is loaded; failures stay blank. */
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
fun Avatar(api: NoctApi, url: String, name: String, size: Dp) = Box(
    Modifier.size(size).clip(CircleShape).background(Segment),
    contentAlignment = Alignment.Center,
) {
    if (url.isNotEmpty()) NetImage(api, url, Modifier.fillMaxSize(), maxSide = 256)
    else Text(name.take(2).uppercase(), color = Body, fontSize = (size.value * 0.34f).sp, fontWeight = FontWeight.Medium)
}
