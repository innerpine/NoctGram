package com.noctgram.app

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.util.UUID

/** One reader may give a post at most this many Stars in total, as the server enforces. */
private const val SUPPORT_LIMIT = 10_000L

/** What the support sheet knows and is sending. */
class SupportState {
    var balance by mutableStateOf<Long?>(null)
    var amount by mutableStateOf("")
    var busy by mutableStateOf(false)
    var error by mutableStateOf("")
    /** The Stars just sent: the sheet then says thank you instead of asking again. */
    var sent by mutableStateOf(0L)
    /** Kept while the amount stays the same, so a retry after a lost answer cannot pay twice. */
    var pending: Pair<Long, String>? = null
}

/** «Поддержать»: send the author of a post some of this account's Noct Stars, as the site's support panel does. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SupportSheet(model: AppModel, post: JSONObject, feed: FeedState, onClose: () -> Unit) {
    val scope = rememberCoroutineScope()
    val state = remember { SupportState() }
    val live = !LocalInspectionMode.current
    val remaining = (SUPPORT_LIMIT - feed.mySupport(post)).coerceAtLeast(0)
    LaunchedEffect(Unit) {
        if (!live) return@LaunchedEffect
        try {
            val balance = model.api.get("/api/social", mapOf("action" to "wallet")).optLong("balance")
            state.balance = balance
            if (state.amount.isEmpty()) state.amount = minOf(100L, balance, remaining).coerceAtLeast(0).toString()
        } catch (failure: ApiException) { state.error = failure.message.orEmpty() }
    }
    fun send() {
        val value = state.amount.toLongOrNull() ?: return
        val key = state.pending?.takeIf { it.first == value }?.second ?: UUID.randomUUID().toString().also { state.pending = value to it }
        state.busy = true
        state.error = ""
        scope.launch {
            try {
                val result = model.api.post(
                    "/api/social",
                    JSONObject().put("action", "support").put("id", post.optString("id")).put("amount", value).put("key", key),
                )
                state.balance = result.optLong("balance", (state.balance ?: value) - value)
                state.pending = null
                feed.supported(post, value)
                state.sent = value
            } catch (failure: ApiException) { state.error = failure.message.orEmpty() }
            state.busy = false
        }
    }
    ModalBottomSheet(
        onDismissRequest = onClose,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Popover,
        dragHandle = { Box(Modifier.padding(top = 10.dp).size(width = 36.dp, height = 4.dp).clip(CircleShape).background(Fill14)) },
    ) {
        SupportContent(model, post, state, remaining, onSend = ::send, onClose = onClose)
    }
}

@Composable
internal fun SupportContent(model: AppModel, post: JSONObject, state: SupportState, remaining: Long, onSend: () -> Unit, onClose: () -> Unit) = Column(
    Modifier.fillMaxWidth().navigationBarsPadding().padding(start = 20.dp, end = 20.dp, top = 18.dp, bottom = 22.dp),
    horizontalAlignment = Alignment.CenterHorizontally,
) {
    val author = {
        onClose()
        model.open(Screen.Profile(post.optString("userId")))
    }
    if (state.sent > 0) {
        StarsIcon(64.dp)
        Text("Спасибо за поддержку", fontSize = 20.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 14.dp))
        Text(
            "${post.optString("name")} получит ${groupedNumber(state.sent)} ${plural(state.sent, "звезду", "звезды", "звёзд")}.",
            color = Secondary, fontSize = 14.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 6.dp),
        )
        state.balance?.let { Text("На балансе ${groupedNumber(it)}", color = Muted, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp)) }
        NoctButton("Готово", onClose, Modifier.fillMaxWidth().padding(top = 22.dp))
        return@Column
    }
    Avatar(model.api, post.optString("avatar"), post.optString("name"), 54.dp, Modifier.clickable(onClick = author))
    DisplayName(post, fontSize = 19.sp, weight = FontWeight.SemiBold, modifier = Modifier.padding(top = 12.dp).clickable(onClick = author))
    Text(
        "За эту публикацию можно отправить ещё ${groupedNumber(remaining)} ${plural(remaining, "звезду", "звезды", "звёзд")}.",
        color = Muted, fontSize = 13.sp, lineHeight = 18.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 4.dp).width(300.dp),
    )
    val balance = state.balance
    val max = minOf(balance ?: 0, remaining)
    val value = state.amount.toLongOrNull() ?: 0
    val valid = value in 1..max
    Row(Modifier.padding(top = 18.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        StarsIcon(30.dp)
        BasicTextField(
            state.amount,
            { typed -> state.amount = typed.filter(Char::isDigit).take(5).trimStart('0') },
            enabled = balance != null && !state.busy,
            singleLine = true,
            textStyle = TextStyle(fontFamily = Inter, fontSize = 34.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-1).sp, color = Foreground),
            cursorBrush = SolidColor(Gold),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            modifier = Modifier.widthIn(min = 28.dp).width(IntrinsicSize.Min),
            decorationBox = { field ->
                Box {
                    if (state.amount.isEmpty()) Text("0", fontSize = 34.sp, fontWeight = FontWeight.SemiBold, color = Muted)
                    field()
                }
            },
        )
    }
    if (max >= 1) ThinSlider(
        value.coerceIn(1, max).toFloat(),
        { state.amount = it.toLong().toString() },
        1f..max.toFloat().coerceAtLeast(1f),
        enabled = !state.busy,
        color = Gold,
        modifier = Modifier.padding(top = 8.dp),
    )
    val presets = listOf(10L, 100L, 1000L, max).filter { it in 1..max }.distinct()
    if (presets.isNotEmpty()) Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        for (preset in presets) Chip(groupedNumber(preset), value == preset) { state.amount = preset.toString() }
    }
    Text(
        when {
            balance == null -> "Загружаем баланс…"
            balance == 0L -> "На балансе нет звёзд. Пополнить его можно на сайте."
            else -> "Баланс: ${groupedNumber(balance)} ${plural(balance, "звезда", "звезды", "звёзд")}"
        },
        color = Muted, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 14.dp),
    )
    if (state.error.isNotEmpty()) ErrorNote(state.error, Modifier.padding(top = 12.dp))
    Row(
        Modifier.padding(top = 16.dp).fillMaxWidth().height(46.dp).clip(CircleShape)
            .background(if (valid && !state.busy) Foreground else Fill6)
            .clickable(enabled = valid && !state.busy, role = Role.Button, onClick = onSend),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
    ) {
        Text(
            if (state.busy) "Отправляем…" else "Поддержать · ${groupedNumber(value)}",
            color = if (valid && !state.busy) Background else Muted, fontSize = 15.sp, fontWeight = FontWeight.SemiBold,
        )
        StarsIcon(18.dp)
    }
    Spacer(Modifier.height(4.dp))
}

/** Screenshot tests: the sheet's content without the platform bottom sheet around it. */
@Composable
internal fun SupportPreview(model: AppModel, post: JSONObject, balance: Long, amount: Long) {
    val state = remember { SupportState().apply { this.balance = balance; this.amount = amount.toString() } }
    Box(Modifier.fillMaxWidth().background(Popover)) {
        SupportContent(model, post, state, SUPPORT_LIMIT - post.optLong("mySupport"), onSend = {}, onClose = {})
    }
}
