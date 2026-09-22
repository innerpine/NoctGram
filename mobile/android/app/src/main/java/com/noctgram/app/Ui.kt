package com.noctgram.app

import android.content.Context
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.util.LruCache
import android.widget.Toast
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.LocalTextSelectionColors
import androidx.compose.foundation.text.selection.TextSelectionColors
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.ClipboardManager
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject

// ---------------------------------------------------------------- tokens (DESIGN.md)

// Surfaces: black ground, #0C0C0C cards, #161616 menus, #141414 covers, #242424 chosen segment.
val Background = Color(0xFF000000)
val Card = Color(0xFF0C0C0C)
val Popover = Color(0xFF161616)
val Cover = Color(0xFF141414)
val Segment = Color(0xFF242424)

// Text: white at 100 / 75 / 60 / 48 %, plus the site's #D0D0D0 for post bodies.
val Foreground = Color(0xFFFFFFFF)
val PostText = Color(0xFFD0D0D0)
val Body = Color(0xBFFFFFFF)
val Secondary = Color(0x99FFFFFF)
val Muted = Color(0x7AFFFFFF)

// Borders 8 % and 14 %, interaction fills 6 / 10 / 14 %.
val Hairline = Color(0x14FFFFFF)
val Border = Color(0x24FFFFFF)
val Fill6 = Color(0x0FFFFFFF)
val Fill10 = Color(0x1AFFFFFF)
val Fill14 = Color(0x24FFFFFF)

val InputBackground = Color(0xFF19191C)
val InputBorder = Color(0xFF303036)
val Accent = Color(0xFFAF9ADD)
val Gold = Color(0xFFFFD36A)
val Green = Color(0xFF3ECF8E)
val Danger = Color(0xFFEF4444)
val Incoming = Color(0xFF121212)
val Outgoing = Color(0xFF242424)

/** Inter for the interface, Instrument Sans only for the «noctgram» word, as on the site. */
val Inter = FontFamily(
    Font(R.font.inter_regular, FontWeight.Normal),
    Font(R.font.inter_medium, FontWeight.Medium),
    Font(R.font.inter_semibold, FontWeight.SemiBold),
)
val Brand = FontFamily(Font(R.font.instrument_sans_semibold, FontWeight.SemiBold))

/** Room for the floating tab bar, so the last item of a list can scroll above it. */
val TabBarSpace = 104.dp

/** The site's --motion curve. */
val Motion = CubicBezierEasing(0.22f, 1f, 0.36f, 1f)

private val BaseText = TextStyle(fontFamily = Inter, fontSize = 15.sp, lineHeight = 22.sp, letterSpacing = (-0.16).sp)

private fun Typography.inter() = Typography(
    displayLarge = displayLarge.copy(fontFamily = Inter), displayMedium = displayMedium.copy(fontFamily = Inter),
    displaySmall = displaySmall.copy(fontFamily = Inter), headlineLarge = headlineLarge.copy(fontFamily = Inter),
    headlineMedium = headlineMedium.copy(fontFamily = Inter), headlineSmall = headlineSmall.copy(fontFamily = Inter),
    titleLarge = titleLarge.copy(fontFamily = Inter), titleMedium = titleMedium.copy(fontFamily = Inter),
    titleSmall = titleSmall.copy(fontFamily = Inter), bodyLarge = bodyLarge.copy(fontFamily = Inter),
    bodyMedium = bodyMedium.copy(fontFamily = Inter), bodySmall = bodySmall.copy(fontFamily = Inter),
    labelLarge = labelLarge.copy(fontFamily = Inter), labelMedium = labelMedium.copy(fontFamily = Inter),
    labelSmall = labelSmall.copy(fontFamily = Inter),
)

@Composable
fun NoctTheme(content: @Composable () -> Unit) = MaterialTheme(
    colorScheme = darkColorScheme(
        primary = Foreground,
        onPrimary = Background,
        secondary = Accent,
        background = Background,
        onBackground = Foreground,
        surface = Popover,
        onSurface = Foreground,
        surfaceVariant = Segment,
        onSurfaceVariant = Secondary,
        surfaceContainer = Popover,
        surfaceContainerHigh = Popover,
        outline = Border,
        outlineVariant = Hairline,
        error = Danger,
    ),
    typography = Typography().inter(),
) {
    // Without these every Text without a colour would be black on the black ground.
    CompositionLocalProvider(
        LocalContentColor provides Foreground,
        LocalTextStyle provides BaseText,
        LocalTextSelectionColors provides TextSelectionColors(Accent, Accent.copy(alpha = 0.35f)),
        content = content,
    )
}

// ---------------------------------------------------------------- building blocks

/** A card of the site: #0C0C0C, 8 % border, 16 dp corners. */
fun Modifier.noctCard(shape: Shape = RoundedCornerShape(16.dp), color: Color = Card, border: Color = Hairline) =
    clip(shape).background(color).border(1.dp, border, shape)

/** Draws the content [amount] higher and gives that space back, so nothing is left empty below. */
fun Modifier.overlapUp(amount: Dp) = layout { measurable, constraints ->
    val placeable = measurable.measure(constraints)
    val shift = amount.roundToPx()
    layout(placeable.width, (placeable.height - shift).coerceAtLeast(0)) { placeable.place(0, -shift) }
}

@Composable
fun HairlineDivider(modifier: Modifier = Modifier) = Box(modifier.fillMaxWidth().height(1.dp).background(Hairline))

enum class Tone { Primary, Secondary, Quiet, Danger }

/**
 * The site's buttons: the white pill is the one main action on a screen,
 * the secondary one is a 12 dp rounded 6 % fill with a hairline border.
 */
@Composable
fun NoctButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tone: Tone = Tone.Primary,
    enabled: Boolean = true,
    icon: ImageVector? = null,
    compact: Boolean = false,
) {
    val shape = if (tone == Tone.Secondary) RoundedCornerShape(12.dp) else CircleShape
    val background = when {
        !enabled -> Fill6
        tone == Tone.Primary -> Foreground
        tone == Tone.Secondary -> Fill6
        tone == Tone.Danger -> Danger.copy(alpha = 0.1f)
        else -> Color.Transparent
    }
    val content = when {
        !enabled -> Muted
        tone == Tone.Primary -> Background
        tone == Tone.Danger -> Color(0xFFF58A8A)
        else -> Foreground
    }
    val border = when {
        tone == Tone.Secondary || !enabled -> Hairline
        tone == Tone.Danger -> Danger.copy(alpha = 0.25f)
        else -> Color.Transparent
    }
    Row(
        modifier.height(if (compact) 34.dp else 40.dp).clip(shape).background(background).border(1.dp, border, shape)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = if (compact) 14.dp else 18.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
    ) {
        icon?.let { Icon(it, contentDescription = null, tint = content, modifier = Modifier.size(16.dp)) }
        Text(text, color = content, fontSize = 13.sp, fontWeight = FontWeight.Medium, maxLines = 1)
    }
}

@Composable
fun PrimaryButton(text: String, enabled: Boolean = true, modifier: Modifier = Modifier, onClick: () -> Unit) =
    NoctButton(text, onClick, modifier, Tone.Primary, enabled)

@Composable
fun SecondaryButton(text: String, enabled: Boolean = true, modifier: Modifier = Modifier, onClick: () -> Unit) =
    NoctButton(text, onClick, modifier, Tone.Secondary, enabled)

/** A round icon button, 40 dp touch target, the site's 60 % grey by default. */
@Composable
fun IconAction(
    icon: ImageVector,
    label: String,
    modifier: Modifier = Modifier,
    tint: Color = Secondary,
    size: Dp = 40.dp,
    iconSize: Dp = 20.dp,
    background: Color = Color.Transparent,
    enabled: Boolean = true,
    onClick: () -> Unit,
) = Box(
    modifier.size(size).clip(CircleShape).background(background)
        .clickable(enabled = enabled, onClickLabel = label, role = Role.Button, onClick = onClick),
    contentAlignment = Alignment.Center,
) { Icon(icon, contentDescription = label, tint = if (enabled) tint else Muted, modifier = Modifier.size(iconSize)) }

/** Title bar of a screen opened on top of the tabs. */
@Composable
fun TopBar(
    title: String,
    onBack: () -> Unit,
    subtitle: String? = null,
    leading: (@Composable () -> Unit)? = null,
    actions: @Composable RowScope.() -> Unit = {},
) = Column(Modifier.fillMaxWidth().background(Background).statusBarsPadding()) {
    Row(
        Modifier.fillMaxWidth().height(56.dp).padding(start = 6.dp, end = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        IconAction(Lucide.ArrowLeft, "Назад", tint = Foreground, onClick = onBack)
        leading?.invoke()
        Column(Modifier.weight(1f).padding(start = 2.dp)) {
            Text(title, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.2).sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            subtitle?.let { Text(it, color = Muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        }
        actions()
    }
    HairlineDivider()
}

/** The site's form field: #19191C, #303036 border, 12 dp corners, violet border while typing. */
@Composable
fun NoctField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    placeholder: String = "",
    hint: String? = null,
    singleLine: Boolean = false,
    minLines: Int = 1,
    maxLines: Int = if (singleLine) 1 else Int.MAX_VALUE,
    enabled: Boolean = true,
    textStyle: TextStyle = BaseText,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
) {
    var focused by remember { mutableStateOf(false) }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(7.dp)) {
        label?.let { Text(it, color = Secondary, fontSize = 13.sp, fontWeight = FontWeight.Medium) }
        BasicTextField(
            value,
            onValueChange,
            enabled = enabled,
            singleLine = singleLine,
            minLines = minLines,
            maxLines = maxLines,
            textStyle = textStyle.copy(color = if (enabled) Foreground else Muted),
            cursorBrush = SolidColor(Accent),
            keyboardOptions = keyboardOptions,
            keyboardActions = keyboardActions,
            modifier = Modifier.fillMaxWidth().onFocusChanged { focused = it.isFocused },
            decorationBox = { field ->
                val shape = RoundedCornerShape(12.dp)
                Box(
                    Modifier.fillMaxWidth().clip(shape).background(InputBackground)
                        .border(1.dp, if (focused) Color(0xFFA390D5) else InputBorder, shape)
                        .padding(horizontal = 14.dp, vertical = 12.dp),
                ) {
                    if (value.isEmpty() && placeholder.isNotEmpty()) Text(placeholder, style = textStyle, color = Muted)
                    field()
                }
            },
        )
        hint?.let { Text(it, color = Muted, fontSize = 12.sp, lineHeight = 16.sp) }
    }
}

/** The rounded input of chats and comments: a 6 % pill with an optional button inside on the left. */
@Composable
fun MessageField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    leading: (@Composable () -> Unit)? = null,
) = BasicTextField(
    value,
    onValueChange,
    maxLines = 6,
    textStyle = BaseText.copy(color = Foreground, lineHeight = 21.sp),
    cursorBrush = SolidColor(Accent),
    modifier = modifier,
    decorationBox = { field ->
        Row(
            Modifier.fillMaxWidth().heightIn(min = 46.dp).clip(RoundedCornerShape(23.dp)).background(Fill6)
                .border(1.dp, Hairline, RoundedCornerShape(23.dp)).padding(start = if (leading != null) 4.dp else 16.dp, end = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            leading?.invoke()
            Box(Modifier.weight(1f).padding(vertical = 12.dp)) {
                if (value.isEmpty()) Text(placeholder, color = Muted, style = BaseText)
                field()
            }
        }
    },
)

/** The feed's «Для вас / Подписки»: a 44 dp track with a #242424 pill that slides to the choice. */
@Composable
fun Segmented(options: List<String>, selected: Int, modifier: Modifier = Modifier, onSelect: (Int) -> Unit) = BoxWithConstraints(
    modifier.fillMaxWidth().height(44.dp).clip(CircleShape).background(Card).border(1.dp, Hairline, CircleShape).padding(3.dp),
) {
    val width = maxWidth / options.size
    val offset by animateDpAsState(width * selected, tween(300, easing = Motion), label = "segment")
    Box(Modifier.offset(x = offset).width(width).fillMaxHeight().clip(CircleShape).background(Segment))
    Row(Modifier.fillMaxSize()) {
        options.forEachIndexed { index, label ->
            Box(
                Modifier.weight(1f).fillMaxHeight().clip(CircleShape)
                    .clickable(remember { MutableInteractionSource() }, indication = null, role = Role.Tab) { onSelect(index) },
                contentAlignment = Alignment.Center,
            ) {
                Text(label, color = if (index == selected) Foreground else Muted, fontSize = 13.sp, fontWeight = FontWeight.Medium)
            }
        }
    }
}

/** A choice among a few: #242424 with a 14 % border when chosen, a hairline outline otherwise. */
@Composable
fun Chip(label: String, selected: Boolean, modifier: Modifier = Modifier, icon: ImageVector? = null, onClick: () -> Unit) = Row(
    modifier.height(34.dp).clip(CircleShape).background(if (selected) Segment else Color.Transparent)
        .border(1.dp, if (selected) Border else Hairline, CircleShape)
        .clickable(role = Role.RadioButton, onClick = onClick).padding(horizontal = 14.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(6.dp),
) {
    icon?.let { Icon(it, contentDescription = null, tint = if (selected) Foreground else Secondary, modifier = Modifier.size(15.dp)) }
    Text(label, color = if (selected) Foreground else Secondary, fontSize = 13.sp, fontWeight = FontWeight.Medium, maxLines = 1)
}

/** A soft pulse standing in for content that is still loading. */
@Composable
fun Modifier.skeleton(shape: Shape = RoundedCornerShape(8.dp)): Modifier {
    val alpha by rememberInfiniteTransition(label = "skeleton")
        .animateFloat(0.05f, 0.1f, infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "pulse")
    return clip(shape).background(Color.White.copy(alpha = alpha))
}

@Composable
fun EmptyState(icon: ImageVector, title: String, text: String, modifier: Modifier = Modifier, action: (@Composable () -> Unit)? = null) = Column(
    modifier.fillMaxWidth().padding(horizontal = 32.dp, vertical = 44.dp),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.spacedBy(10.dp),
) {
    Box(Modifier.size(56.dp).clip(CircleShape).background(Fill6).border(1.dp, Hairline, CircleShape), Alignment.Center) {
        Icon(icon, contentDescription = null, tint = Secondary, modifier = Modifier.size(24.dp))
    }
    Text(title, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
    Text(text, color = Muted, fontSize = 14.sp, lineHeight = 20.sp, textAlign = TextAlign.Center)
    action?.let {
        Spacer(Modifier.height(4.dp))
        it()
    }
}

/** An inline problem, in the site's soft red: what went wrong, and a way to try again. */
@Composable
fun ErrorNote(text: String, modifier: Modifier = Modifier, onRetry: (() -> Unit)? = null) = Row(
    modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Color(0x08E19BAA))
        .border(1.dp, Color(0x30E19BAA), RoundedCornerShape(12.dp)).padding(start = 14.dp, end = 6.dp, top = 6.dp, bottom = 6.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(8.dp),
) {
    Icon(Lucide.TriangleAlert, contentDescription = null, tint = Color(0xFFEEB3C0), modifier = Modifier.size(16.dp))
    Text(text, color = Color(0xFFEEB3C0), fontSize = 13.sp, lineHeight = 19.sp, modifier = Modifier.weight(1f).padding(vertical = 6.dp))
    onRetry?.let { IconAction(Lucide.RefreshCw, "Повторить", tint = Color(0xFFEEB3C0), size = 36.dp, iconSize = 16.dp, onClick = it) }
}

@Composable
fun FullScreenError(text: String, retry: () -> Unit) = Box(Modifier.fillMaxSize(), Alignment.Center) {
    EmptyState(Lucide.TriangleAlert, "Не удалось загрузить", text) { NoctButton("Повторить", retry, icon = Lucide.RefreshCw) }
}

/** The «noctgram» word in Instrument Sans. */
@Composable
fun Wordmark(fontSize: TextUnit = 24.sp, modifier: Modifier = Modifier) =
    Text("noctgram", modifier = modifier, fontFamily = Brand, fontWeight = FontWeight.SemiBold, fontSize = fontSize, letterSpacing = (-0.03f * fontSize.value).sp)

/** Copies text; older Android shows no system confirmation, so a short toast says it. */
fun copyText(context: Context, clipboard: ClipboardManager, text: String, what: String) {
    clipboard.setText(AnnotatedString(text))
    if (Build.VERSION.SDK_INT < 33) Toast.makeText(context, "$what скопирован", Toast.LENGTH_SHORT).show()
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

/** Russian plural: plural(5, "подписчик", "подписчика", "подписчиков"). */
fun plural(value: Long, one: String, few: String, many: String): String {
    val a = value % 10
    val b = value % 100
    return when {
        a == 1L && b != 11L -> one
        a in 2..4 && (b < 12 || b > 14) -> few
        else -> many
    }
}

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
    val accent get() = if (active) first else Foreground
}

/** An icon painted with a gradient, like the site's Premium mark in the palette colours. */
@Composable
fun GradientIcon(icon: ImageVector, colors: List<Color>, dp: Dp, label: String?) = Icon(
    icon,
    contentDescription = label,
    tint = Color.White,
    modifier = Modifier.size(dp).graphicsLayer(compositingStrategy = CompositingStrategy.Offscreen).drawWithCache {
        val brush = Brush.linearGradient(colors, Offset.Zero, Offset(size.width, size.height))
        onDrawWithContent {
            drawContent()
            drawRect(brush, blendMode = BlendMode.SrcIn)
        }
    },
)

@Composable
fun DisplayName(
    person: JSONObject,
    fontSize: TextUnit = 15.sp,
    modifier: Modifier = Modifier,
    weight: FontWeight = FontWeight.Medium,
) {
    val look = Look(person)
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        Text(
            person.optString("name"),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f, fill = false),
            style = TextStyle(
                fontFamily = Inter,
                fontSize = fontSize,
                fontWeight = weight,
                letterSpacing = if (fontSize.value > 24) (-1.2).sp else (-0.2).sp,
                brush = if (look.nameGradient) Brush.linearGradient(listOf(look.first, look.second)) else SolidColor(Foreground),
            ),
        )
        val badge = (fontSize.value * 0.95f).coerceAtMost(22f).dp
        if (look.verified) Icon(Lucide.BadgeCheck, "Подтверждённый аккаунт", tint = Color(0xFF6CB6FF), modifier = Modifier.size(badge))
        if (look.premium) GradientIcon(Lucide.StarFilled, listOf(look.first, look.second), badge, "Noct Premium")
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
        ?: Box(modifier.background(Cover))
}

@Composable
fun Avatar(api: NoctApi, url: String, name: String, size: Dp, modifier: Modifier = Modifier) = Box(
    modifier.size(size).clip(CircleShape).background(Color(0xFF202020)),
    contentAlignment = Alignment.Center,
) {
    if (url.isNotEmpty()) NetImage(api, url, Modifier.fillMaxSize(), maxSide = 256)
    else Text(
        name.trim().take(1).uppercase().ifEmpty { "N" },
        color = Body,
        fontSize = (size.value * 0.38f).sp,
        fontWeight = FontWeight.Medium,
        letterSpacing = (-0.5).sp,
    )
}

/**
 * The large profile avatar with its Premium decorations: the rotating text
 * ring (one turn in 24 s, as on the site) and the Chrome Flow rim. [edge] is
 * the dark ring that separates the avatar from the cover.
 */
@Composable
fun ProfileAvatar(api: NoctApi, person: JSONObject, size: Dp, edge: Color = Card) {
    val look = Look(person)
    val ring = look.ringText.isNotBlank()
    val face = size + 10.dp
    val outer = face + if (ring) 44.dp else if (look.chrome) 12.dp else 0.dp
    val turn = rememberInfiniteTransition(label = "avatar")
    Box(Modifier.size(outer), contentAlignment = Alignment.Center) {
        if (look.chrome) {
            val angle by turn.animateFloat(0f, 360f, infiniteRepeatable(tween(look.chromeTempo * 750, easing = LinearEasing), RepeatMode.Restart), label = "chrome")
            Canvas(Modifier.size(face + 10.dp).rotate(angle)) {
                drawCircle(
                    Brush.sweepGradient(listOf(Color.White, lerp(look.second, Color.White, 0.6f), Color(0xFF17171D), look.first, Color.White, lerp(look.second, Color.White, 0.6f), Color(0xFF17171D), look.first, Color.White)),
                    style = Stroke(3.dp.toPx()),
                )
            }
        }
        if (ring) {
            val angle by turn.animateFloat(0f, 360f, infiniteRepeatable(tween(24_000, easing = LinearEasing), RepeatMode.Restart), label = "ring")
            val textSize = with(LocalDensity.current) { 10.5.sp.toPx() }
            Canvas(Modifier.size(outer).rotate(angle)) {
                val radius = face.toPx() / 2 + 8.dp.toPx()
                val path = android.graphics.Path().apply { addCircle(center.x, center.y, radius, android.graphics.Path.Direction.CW) }
                val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
                    color = look.first.toArgb()
                    this.textSize = textSize
                    letterSpacing = 0.14f
                    isFakeBoldText = true
                }
                drawIntoCanvas { it.nativeCanvas.drawTextOnPath(look.ringText.uppercase(), path, 0f, 0f, paint) }
            }
        }
        Box(Modifier.size(face).clip(CircleShape).background(edge), contentAlignment = Alignment.Center) {
            Avatar(api, person.optString("avatar"), person.optString("name"), size)
        }
    }
}

/** A person in a list: followers, search results, chat headers. */
@Composable
fun PersonRow(api: NoctApi, person: JSONObject, onClick: () -> Unit, trailing: @Composable () -> Unit = {}) = Row(
    Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 10.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(12.dp),
) {
    Avatar(api, person.optString("avatar"), person.optString("name"), 46.dp)
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        DisplayName(person)
        Text("@" + person.optString("handle"), color = Muted, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
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
