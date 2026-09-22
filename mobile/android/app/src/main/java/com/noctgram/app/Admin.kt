package com.noctgram.app

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.util.UUID

private class AdminAction(val id: String, val label: String, val icon: ImageVector)

/** The site's administration actions, in its order. */
private val AdminActions = listOf(
    AdminAction("stars", "Выдать Stars", Lucide.Star),
    AdminAction("starsDebit", "Отнять Stars", Lucide.CircleMinus),
    AdminAction("premium", "Выдать Premium", Lucide.Sparkles),
    AdminAction("collectible", "Выдать подарки", Lucide.Gift),
    AdminAction("verified", "Верификация", Lucide.BadgeCheck),
    AdminAction("moderator", "Роль модератора", Lucide.ShieldCheck),
)

private fun roleLabel(person: JSONObject) = when {
    person.optInt("administrator") != 0 -> "Администратор"
    person.optInt("moderator") != 0 -> "Модератор"
    person.optString("kind") == "channel" -> "Канал"
    else -> "Пользователь"
}

private fun defaultAmount(kind: String) = when (kind) {
    "stars", "starsDebit" -> "1000"
    "premium" -> "30"
    else -> "1"
}

/** What the administration screen shows: the accounts, the journal and the account being changed. */
class AdminState {
    var sort by mutableIntStateOf(0)
    var query by mutableStateOf("")
    var people by mutableStateOf(listOf<JSONObject>())
    var events by mutableStateOf(listOf<JSONObject>())
    var more by mutableStateOf(false)
    var loading by mutableStateOf(true)
    var error by mutableStateOf("")
    var notice by mutableStateOf("")
    var selected by mutableStateOf<JSONObject?>(null)
    var version by mutableIntStateOf(0)
}

/** Администрирование: the site's panel for Stars, Premium, gifts, verification and roles. Administrators only. */
@Composable
fun AdminScreen(model: AppModel) {
    val state = remember { AdminState() }
    val scope = rememberCoroutineScope()
    val live = !LocalInspectionMode.current
    LaunchedEffect(state.sort, state.query, state.version) {
        if (!live) return@LaunchedEffect
        // Typing a name asks the server once the letters stop coming.
        delay(250)
        state.loading = true
        try {
            val page = model.api.get(
                "/api/social",
                mapOf("action" to "administration", "sort" to if (state.sort == 1) "balance" else "recent", "q" to state.query.trim()),
            )
            state.people = page.objects("people")
            state.more = page.optBoolean("more")
            state.events = page.objects("events")
            state.selected = state.selected?.let { old -> state.people.firstOrNull { it.optString("id") == old.optString("id") } ?: old }
            state.error = ""
        } catch (failure: ApiException) { state.error = failure.message.orEmpty() }
        state.loading = false
    }
    BackHandler(enabled = state.selected != null) { state.selected = null }
    AdminContent(model, state, onMore = {
        scope.launch {
            state.loading = true
            try {
                val page = model.api.get(
                    "/api/social",
                    mapOf("action" to "administration", "sort" to "balance", "offset" to state.people.size.toString(), "q" to state.query.trim()),
                )
                val known = state.people.map { it.optString("id") }.toSet()
                state.people = state.people + page.objects("people").filter { it.optString("id") !in known }
                state.more = page.optBoolean("more")
            } catch (failure: ApiException) { state.error = failure.message.orEmpty() }
            state.loading = false
        }
    })
}

@Composable
internal fun AdminContent(model: AppModel, state: AdminState, onMore: () -> Unit) = Column(Modifier.fillMaxSize().navigationBarsPadding()) {
    val person = state.selected
    TopBar(
        if (person == null) "Администрирование" else "Изменение аккаунта",
        onBack = { if (person != null) state.selected = null else model.back() },
        subtitle = if (person == null) "Stars, Premium, подарки и полномочия" else "@" + person.optString("handle"),
    ) {
        IconAction(Lucide.RefreshCw, "Обновить", enabled = !state.loading) { state.version++ }
    }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(12.dp, 12.dp, 12.dp, 28.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (state.error.isNotEmpty()) item(key = "error") { ErrorNote(state.error) }
        if (state.notice.isNotEmpty()) item(key = "notice") { SuccessNote(state.notice) }
        if (person == null) {
            item(key = "sort") { Segmented(listOf("Недавние", "Самые богатые"), state.sort) { state.sort = it } }
            item(key = "search") { SearchField(state.query, "Имя, основной или дополнительный @юзернейм") { state.query = it } }
            item(key = "people") {
                Column(Modifier.fillMaxWidth().noctCard()) {
                    if (state.loading && state.people.isEmpty()) repeat(5) { PersonSkeleton() }
                    state.people.forEachIndexed { index, it ->
                        if (index > 0) HairlineDivider(Modifier.padding(start = 64.dp))
                        AdminPerson(model, it) {
                            state.selected = it
                            state.notice = ""
                            state.error = ""
                        }
                    }
                    if (!state.loading && state.people.isEmpty())
                        EmptyState(Lucide.Search, "Никого не нашли", "Попробуйте другой юзернейм.")
                }
            }
            if (state.more) item(key = "more") {
                NoctButton(if (state.loading) "Загружаем…" else "Показать ещё", onMore, Modifier.fillMaxWidth(), tone = Tone.Secondary, enabled = !state.loading)
            }
            item(key = "market") { MarketIssue(model) { state.version++ } }
        } else item(key = "grant:" + person.optString("id")) { AdminGrant(model, state, person) }
        item(key = "journal") { Journal(state.events) }
    }
}

@Composable
private fun AdminPerson(model: AppModel, person: JSONObject, onClick: () -> Unit) = Row(
    Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 10.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(12.dp),
) {
    Avatar(model.api, person.optString("avatar"), person.optString("name"), 40.dp)
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        DisplayName(person)
        Text("@${person.optString("handle")} · ${roleLabel(person)}", color = Muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
    if (person.optString("kind") != "channel") Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        StarsIcon(14.dp)
        Text(groupedNumber(person.optLong("balance")), color = Color(0xFFEDD07B), fontSize = 13.sp, fontWeight = FontWeight.Medium)
    }
    Icon(Lucide.ChevronRight, contentDescription = null, tint = Muted, modifier = Modifier.size(16.dp))
}

@Composable
private fun PersonSkeleton() = Row(
    Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(12.dp),
) {
    Box(Modifier.size(40.dp).skeleton(CircleShape))
    Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
        Box(Modifier.size(width = 130.dp, height = 12.dp).skeleton())
        Box(Modifier.size(width = 90.dp, height = 10.dp).skeleton())
    }
}

/** A search pill with the magnifier inside, as in the site's staff panels. */
@Composable
fun SearchField(value: String, placeholder: String, onChange: (String) -> Unit) = BasicTextField(
    value,
    onChange,
    singleLine = true,
    textStyle = androidx.compose.ui.text.TextStyle(fontFamily = Inter, fontSize = 15.sp, color = Foreground),
    cursorBrush = SolidColor(Accent),
    modifier = Modifier.fillMaxWidth(),
    decorationBox = { field ->
        Row(
            Modifier.fillMaxWidth().height(46.dp).clip(RoundedCornerShape(23.dp)).background(Fill6)
                .border(1.dp, Hairline, RoundedCornerShape(23.dp)).padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(Lucide.Search, contentDescription = null, tint = Muted, modifier = Modifier.size(17.dp))
            Box(Modifier.weight(1f)) {
                if (value.isEmpty()) Text(placeholder, color = Muted, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                field()
            }
            if (value.isNotEmpty()) IconAction(Lucide.X, "Очистить", size = 30.dp, iconSize = 15.dp) { onChange("") }
        }
    },
)

@Composable
fun SuccessNote(text: String, modifier: Modifier = Modifier) = Row(
    modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Color(0x0F3ECF8E))
        .border(1.dp, Color(0x333ECF8E), RoundedCornerShape(12.dp)).padding(horizontal = 14.dp, vertical = 12.dp),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(10.dp),
) {
    Icon(Lucide.Check, contentDescription = null, tint = Green, modifier = Modifier.size(16.dp))
    Text(text, color = Color(0xFFB7F0D3), fontSize = 13.sp, lineHeight = 19.sp)
}

@Composable
private fun Label(text: String, trailing: (@Composable () -> Unit)? = null) = Row(verticalAlignment = Alignment.CenterVertically) {
    Text(text, color = Secondary, fontSize = 13.sp, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
    trailing?.invoke()
}

/** Everything that can be done to one account, with the reason the journal keeps. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AdminGrant(model: AppModel, state: AdminState, person: JSONObject) {
    val scope = rememberCoroutineScope()
    val id = person.optString("id")
    val handle = person.optString("handle")
    val channel = person.optString("kind") == "channel"
    var kind by remember(id) { mutableStateOf(if (channel) "verified" else "stars") }
    var amount by remember(id) { mutableStateOf(if (channel) "1" else "1000") }
    var reason by remember(id) { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    // The same request id is reused until the form changes, so a retry cannot apply twice.
    var pending by remember { mutableStateOf<Pair<String, String>?>(null) }
    val balance = person.optLong("balance")
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Row(
            Modifier.fillMaxWidth().noctCard().padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Avatar(model.api, person.optString("avatar"), person.optString("name"), 48.dp)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                DisplayName(person, fontSize = 16.sp)
                Text("@$handle", color = Secondary, fontSize = 13.sp)
                Text(
                    roleLabel(person), color = Body, fontSize = 11.sp, fontWeight = FontWeight.Medium,
                    modifier = Modifier.clip(CircleShape).background(Fill6).border(1.dp, Hairline, CircleShape).padding(horizontal = 8.dp, vertical = 2.dp),
                )
            }
            if (!channel) Column(horizontalAlignment = Alignment.End) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    StarsIcon(16.dp)
                    Text(groupedNumber(balance), color = Color(0xFFEDD07B), fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                }
                Text("баланс Stars", color = Muted, fontSize = 11.sp)
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Label("Действие")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                for (action in AdminActions) if (!channel || action.id == "verified") Chip(action.label, kind == action.id, icon = action.icon) {
                    kind = action.id
                    amount = defaultAmount(action.id)
                    state.notice = ""
                }
            }
        }
        if (kind == "collectible") {
            AdminGiftForm(model, state, person)
            return@Column
        }
        when (kind) {
            "stars", "starsDebit", "premium" -> Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
                Label(if (kind == "premium") "Дней Premium" else "Количество Stars") {
                    if (kind == "starsDebit") Text(
                        "Всё", color = Foreground, fontSize = 13.sp, fontWeight = FontWeight.Medium,
                        modifier = Modifier.clip(CircleShape).clickable { amount = balance.coerceIn(0, 1_000_000).toString() }.padding(horizontal = 8.dp, vertical = 2.dp),
                    )
                }
                NoctField(
                    amount, { amount = it.filter(Char::isDigit).take(7) },
                    placeholder = if (kind == "premium") "От 1 до 365" else "От 1 до 1 000 000",
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                )
            }
            else -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Label("Состояние")
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    val (on, off) = if (kind == "verified") "Подтвердить аккаунт" to "Снять верификацию" else "Назначить модератором" to "Снять роль"
                    Chip(on, amount == "1") { amount = "1" }
                    Chip(off, amount == "0") { amount = "0" }
                }
            }
        }
        NoctField(
            reason, { reason = it.take(500) },
            label = "Причина · ${reason.length}/500",
            placeholder = when (kind) {
                "starsDebit" -> "Например, возврат ошибочного начисления"
                "stars", "premium" -> "Например, награда за помощь в тестировании"
                "verified" -> "Например, подтверждён официальный аккаунт автора"
                else -> "Например, назначение в команду модерации"
            },
            minLines = 3,
        )
        val number = amount.toLongOrNull() ?: 0
        val action = AdminActions.first { it.id == kind }
        Row(
            Modifier.fillMaxWidth().noctCard(RoundedCornerShape(14.dp)).padding(14.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(38.dp).clip(RoundedCornerShape(12.dp)).background(Fill6), Alignment.Center) {
                Icon(action.icon, contentDescription = null, tint = Foreground, modifier = Modifier.size(19.dp))
            }
            Column(Modifier.weight(1f)) {
                Text("После подтверждения", fontSize = 14.sp, fontWeight = FontWeight.Medium)
                Text(
                    when (kind) {
                        "starsDebit" -> "У @$handle спишется ${groupedNumber(number)} Stars. Баланс не может стать отрицательным."
                        "stars" -> "@$handle получит ${groupedNumber(number)} Stars."
                        "premium" -> "Premium для @$handle будет продлён на $number дн."
                        "verified" -> if (amount == "1") "Подтвердить @$handle." else "Снять подтверждение с @$handle."
                        else -> if (amount == "1") "Назначить @$handle модератором." else "Снять роль модератора у @$handle."
                    },
                    color = Secondary, fontSize = 13.sp, lineHeight = 18.sp,
                )
            }
        }
        val valid = reason.isNotBlank() && when (kind) {
            "stars", "starsDebit" -> number in 1..1_000_000
            "premium" -> number in 1..365
            else -> amount == "0" || amount == "1"
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(Lucide.History, contentDescription = null, tint = Muted, modifier = Modifier.size(14.dp))
            Text("Сохраним в журнале", color = Muted, fontSize = 12.sp, modifier = Modifier.weight(1f))
            NoctButton(
                if (busy) "Сохраняем…" else when (kind) {
                    "stars" -> "Выдать Stars"
                    "starsDebit" -> "Отнять Stars"
                    "premium" -> "Выдать Premium"
                    "verified" -> if (amount == "1") "Подтвердить" else "Снять"
                    else -> if (amount == "1") "Назначить" else "Снять роль"
                },
                onClick = {
                    val body = JSONObject().put("action", "adminGrant").put("target", id).put("kind", kind).put("amount", number).put("reason", reason.trim())
                    val fingerprint = body.toString()
                    val request = pending?.takeIf { it.first == fingerprint }?.second ?: UUID.randomUUID().toString().also { pending = fingerprint to it }
                    busy = true
                    state.error = ""
                    state.notice = ""
                    scope.launch {
                        try {
                            model.api.post("/api/social", body.put("requestId", request))
                            pending = null
                            reason = ""
                            state.notice = "Изменение сохранено и записано в журнал."
                            state.version++
                            if (id == model.myId) model.refresh()
                        } catch (failure: ApiException) { state.error = failure.message.orEmpty() }
                        busy = false
                    }
                },
                enabled = valid && !busy,
                icon = Lucide.Check,
            )
        }
    }
}

/** One choice from a list, like the site's staff select: a field that opens a menu. */
@Composable
private fun Picker(label: String, value: String, options: List<Pair<String, String>>, swatch: ((String) -> Brush?)? = null, enabled: Boolean = true, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
        Label(label)
        Box {
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(InputBackground).border(1.dp, InputBorder, RoundedCornerShape(12.dp))
                    .clickable(enabled = enabled && options.isNotEmpty()) { open = true }.padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                swatch?.invoke(value)?.let { Box(Modifier.size(18.dp).clip(CircleShape).background(it)) }
                Text(options.firstOrNull { it.first == value }?.second ?: "Загружаем…", maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                Icon(Lucide.ChevronDown, contentDescription = null, tint = Muted, modifier = Modifier.size(16.dp))
            }
            DropdownMenu(
                open, { open = false },
                modifier = Modifier.heightIn(max = 380.dp),
                shape = RoundedCornerShape(14.dp), containerColor = Popover, border = androidx.compose.foundation.BorderStroke(1.dp, Hairline),
            ) {
                for ((id, text) in options) DropdownMenuItem(
                    text = { Text(text, fontSize = 14.sp) },
                    leadingIcon = swatch?.invoke(id)?.let { brush -> { Box(Modifier.size(16.dp).clip(CircleShape).background(brush)) } },
                    trailingIcon = if (id == value) ({ Icon(Lucide.Check, contentDescription = null, tint = Foreground, modifier = Modifier.size(16.dp)) }) else null,
                    onClick = {
                        onPick(id)
                        open = false
                    },
                )
            }
        }
    }
}

private fun rarity(attribute: JSONObject) =
    "%.1f %%".format(java.util.Locale("ru"), attribute.optInt("rarityPermille") / 10.0).replace(",0 %", " %")

private fun hexColor(value: String): Color =
    runCatching { Color(android.graphics.Color.parseColor(value)) }.getOrDefault(Segment)

/** «Выдать подарки»: a finished collectible from a collection with chosen attributes, as the site issues it. */
@Composable
private fun AdminGiftForm(model: AppModel, state: AdminState, person: JSONObject) {
    val scope = rememberCoroutineScope()
    val live = !LocalInspectionMode.current
    val target = person.optString("id")
    var gifts by remember { mutableStateOf(listOf<JSONObject>()) }
    var giftId by remember { mutableStateOf("") }
    var collection by remember { mutableStateOf<JSONObject?>(null) }
    var next by remember { mutableStateOf(1L) }
    var modelId by remember { mutableStateOf("") }
    var backdropId by remember { mutableStateOf("") }
    var symbolId by remember { mutableStateOf("") }
    var count by remember { mutableStateOf("1") }
    var start by remember { mutableStateOf("") }
    var keep by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("") }
    var reason by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var pending by remember { mutableStateOf<Pair<String, String>?>(null) }
    LaunchedEffect(giftId) {
        if (!live) return@LaunchedEffect
        try {
            val page = model.api.get("/api/social", mapOf("action" to "adminGiftCatalog", "giftId" to giftId))
            gifts = page.objects("gifts")
            if (giftId.isEmpty()) {
                giftId = gifts.firstOrNull()?.optString("id").orEmpty()
                return@LaunchedEffect
            }
            val loaded = page.optJSONObject("collection") ?: return@LaunchedEffect
            collection = loaded
            next = page.optLong("nextNumber", 1)
            fun keepOrFirst(list: String, current: String) =
                loaded.objects(list).let { all -> if (all.any { it.optString("id") == current }) current else all.firstOrNull()?.optString("id").orEmpty() }
            modelId = keepOrFirst("models", modelId)
            backdropId = keepOrFirst("backdrops", backdropId)
            symbolId = keepOrFirst("symbols", symbolId)
            state.error = ""
        } catch (failure: ApiException) { state.error = failure.message.orEmpty() }
    }
    val current = collection?.takeIf { it.optString("id") == giftId }
    val models = current?.objects("models").orEmpty()
    val backdrops = current?.objects("backdrops").orEmpty()
    val symbols = current?.objects("symbols").orEmpty()
    val backdrop = backdrops.firstOrNull { it.optString("id") == backdropId }
    val amount = count.toIntOrNull() ?: 0
    val first = start.toLongOrNull() ?: next
    val name = gifts.firstOrNull { it.optString("id") == giftId }?.optString("name").orEmpty()
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Picker("Коллекция", giftId, gifts.map { it.optString("id") to it.optString("name") }, enabled = !busy) { giftId = it }
        // The site draws the collectible here; the app shows its backdrop, name and numbers.
        Box(
            Modifier.fillMaxWidth().height(132.dp).clip(RoundedCornerShape(18.dp))
                .background(
                    if (backdrop != null) Brush.radialGradient(listOf(hexColor(backdrop.optString("centerColor")), hexColor(backdrop.optString("edgeColor"))))
                    else Brush.linearGradient(listOf(Segment, Card)),
                ),
            contentAlignment = Alignment.Center,
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Icon(Lucide.Gift, contentDescription = null, tint = Color.White, modifier = Modifier.size(34.dp))
                Text(name.ifEmpty { "Подарок" }, color = Color.White, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                Text(
                    if (amount > 1) "#$first–#${first + amount - 1}" else "#$first",
                    color = Color.White.copy(alpha = 0.75f), fontSize = 13.sp,
                )
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Lucide.ShieldCheck, contentDescription = null, tint = Secondary, modifier = Modifier.size(16.dp))
            Text("Выдача администратора: Stars не списываются, атрибуты после выдачи не меняются.", color = Secondary, fontSize = 12.sp, lineHeight = 17.sp)
        }
        Picker("Модель", modelId, models.map { it.optString("id") to "${it.optString("name")} · ${rarity(it)}" }, enabled = !busy) { modelId = it }
        Picker(
            "Фон", backdropId, backdrops.map { it.optString("id") to "${it.optString("name")} · ${rarity(it)}" },
            swatch = { id ->
                backdrops.firstOrNull { it.optString("id") == id }?.let {
                    Brush.linearGradient(listOf(hexColor(it.optString("centerColor")), hexColor(it.optString("edgeColor"))))
                }
            },
            enabled = !busy,
        ) { backdropId = it }
        Picker("Узор", symbolId, symbols.map { it.optString("id") to "${it.optString("name")} · ${rarity(it)}" }, enabled = !busy) { symbolId = it }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            NoctField(
                count, { count = it.filter(Char::isDigit).take(2) }, Modifier.width(110.dp),
                label = "Сколько", placeholder = "1–10", singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            )
            NoctField(
                start, { start = it.filter(Char::isDigit).take(10) }, Modifier.weight(1f),
                label = "Первый номер", placeholder = "Следующий — #$next", singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            )
        }
        Text(
            "Пустой номер — автоматическая нумерация. Номер уникален внутри коллекции: если занят хотя бы один номер серии, ничего не будет выдано.",
            color = Muted, fontSize = 12.sp, lineHeight = 17.sp,
        )
        Row(
            Modifier.fillMaxWidth().noctCard(RoundedCornerShape(14.dp)).padding(start = 14.dp, end = 10.dp, top = 6.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Показывать отправителя и подпись в подарке", fontSize = 14.sp, modifier = Modifier.weight(1f))
            Switch(keep, { keep = it }, enabled = !busy, colors = noctSwitchColors())
        }
        if (keep) NoctField(message, { message = it.take(240) }, label = "Подпись получателю", placeholder = "Например, для команды разработчиков", minLines = 2)
        NoctField(reason, { reason = it.take(500) }, label = "Причина для журнала · ${reason.length}/500", placeholder = "Например, награда за разработку Noctgram", minLines = 2)
        val valid = giftId.isNotEmpty() && modelId.isNotEmpty() && backdropId.isNotEmpty() && symbolId.isNotEmpty() &&
            amount in 1..10 && reason.isNotBlank() && (start.isEmpty() || (start.toLongOrNull() ?: 0) >= 1)
        NoctButton(
            if (busy) "Выдаём…" else if (amount > 1) "Выдать $amount подарков" else "Выдать подарок",
            onClick = {
                val body = JSONObject().put("action", "adminGiftGrant").put("target", target).put("giftId", giftId)
                    .put("modelId", modelId).put("backdropId", backdropId).put("symbolId", symbolId).put("count", amount)
                    .put("startNumber", if (start.isEmpty()) JSONObject.NULL else start.toLong())
                    .put("keepOriginal", keep).put("message", if (keep) message.trim() else "").put("reason", reason.trim())
                val fingerprint = body.toString()
                val request = pending?.takeIf { it.first == fingerprint }?.second ?: UUID.randomUUID().toString().also { pending = fingerprint to it }
                busy = true
                state.error = ""
                state.notice = ""
                scope.launch {
                    try {
                        val result = model.api.post("/api/social", body.put("requestId", request))
                        pending = null
                        reason = ""
                        val from = result.optLong("firstNumber")
                        val to = result.optLong("lastNumber", from)
                        state.notice = "Выданы подарки $name ${if (from == to) "#$from" else "#$from–#$to"}. Записано в журнал."
                        state.version++
                        next = to + 1
                        start = ""
                    } catch (failure: ApiException) { state.error = failure.message.orEmpty() }
                    busy = false
                }
            },
            modifier = Modifier.fillMaxWidth(),
            enabled = valid && !busy,
            icon = Lucide.Gift,
        )
    }
}

/** «Выпустить лоты Маркета»: numbers or usernames with prices, one per line. */
@Composable
private fun MarketIssue(model: AppModel, onIssued: () -> Unit) {
    val scope = rememberCoroutineScope()
    var open by remember { mutableStateOf(false) }
    var kind by remember { mutableStateOf("number") }
    var lots by remember { mutableStateOf("") }
    var reason by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var notice by remember { mutableStateOf("") }
    var pending by remember { mutableStateOf<Pair<String, String>?>(null) }
    Column(Modifier.fillMaxWidth().noctCard()) {
        Row(
            Modifier.fillMaxWidth().clickable { open = !open }.padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(Lucide.Store, contentDescription = null, tint = Foreground, modifier = Modifier.size(18.dp))
            Text("Выпустить лоты Маркета", fontSize = 15.sp, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
            Icon(if (open) Lucide.ChevronDown else Lucide.ChevronRight, contentDescription = null, tint = Muted, modifier = Modifier.size(16.dp))
        }
        if (open) Column(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Chip("Анонимные номера", kind == "number") { kind = "number" }
                Chip("Юзернеймы", kind == "username") { kind = "username" }
            }
            NoctField(
                lots, { lots = it.take(4000) },
                label = "Лоты",
                placeholder = if (kind == "number") "+888 1234 5678 36000\n77777777 250000" else "noir 48000\nluna 32000",
                hint = "По одному в строке: значение и цена в Stars через пробел. Чтобы изменить цену лота, который уже продаётся, введите его ещё раз с новой ценой.",
                minLines = 4,
            )
            NoctField(reason, { reason = it.take(500) }, label = "Причина · ${reason.length}/500", placeholder = "Например, первый выпуск красивых номеров", minLines = 2)
            if (error.isNotEmpty()) ErrorNote(error)
            if (notice.isNotEmpty()) SuccessNote(notice)
            NoctButton(
                if (busy) "Выпускаем…" else "Выпустить в Маркет",
                onClick = {
                    val body = JSONObject().put("action", "issue").put("kind", kind).put("lots", lots).put("reason", reason.trim())
                    val fingerprint = body.toString()
                    val request = pending?.takeIf { it.first == fingerprint }?.second ?: UUID.randomUUID().toString().also { pending = fingerprint to it }
                    busy = true
                    error = ""
                    notice = ""
                    scope.launch {
                        try {
                            val result = model.api.post("/api/market", body.put("requestId", request))
                            pending = null
                            fun list(name: String) = result.optJSONArray(name)?.let { a -> (0 until a.length()).map(a::optString) }.orEmpty()
                            val skipped = list("skipped")
                            val repriced = list("repriced")
                            notice = "Выпущено лотов: ${list("created").size}." +
                                (if (repriced.isNotEmpty()) " Новая цена: ${repriced.joinToString(", ")}." else "") +
                                (if (skipped.isNotEmpty()) " Без изменений (заняты, проданы или цена та же): ${skipped.joinToString(", ")}." else "")
                            if (skipped.isEmpty()) lots = ""
                            onIssued()
                        } catch (failure: ApiException) { error = failure.message.orEmpty() }
                        busy = false
                    }
                },
                modifier = Modifier.fillMaxWidth(),
                enabled = lots.isNotBlank() && reason.isNotBlank() && !busy,
                icon = Lucide.Check,
            )
        }
    }
}

private fun eventTitle(event: JSONObject): String {
    val action = event.optString("action")
    val amount = event.optLong("amount")
    val label = AdminActions.firstOrNull { it.id == action }?.label ?: if (action == "marketIssue") "Выпуск лотов Маркета" else "Изменение аккаунта"
    val detail = when (action) {
        "stars" -> "+${groupedNumber(amount)}"
        "starsDebit" -> "−${groupedNumber(amount)}"
        "marketIssue", "collectible" -> "· $amount шт."
        "premium" -> "+$amount дн."
        else -> if (amount != 0L) "· включено" else "· снято"
    }
    return "$label $detail"
}

/** The collectibles of a gift event: collection, numbers and attributes, from the saved payload. */
private fun giftDetails(event: JSONObject): String = runCatching {
    val payload = JSONObject(event.optString("payload"))
    val first = payload.getLong("firstNumber")
    val last = first + payload.getLong("count") - 1
    val attributes = payload.optJSONObject("attributes")
    val names = listOf("model", "backdrop", "symbol").mapNotNull { attributes?.optJSONObject(it)?.optString("name")?.takeIf(String::isNotEmpty) }
    listOf(payload.optString("giftId"), if (first == last) "#$first" else "#$first–#$last", names.joinToString(" / "))
        .filter(String::isNotEmpty).joinToString(" · ")
}.getOrDefault("")

@Composable
private fun Journal(events: List<JSONObject>) = Column(Modifier.fillMaxWidth().noctCard().padding(16.dp)) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(Lucide.History, contentDescription = null, tint = Secondary, modifier = Modifier.size(16.dp))
        Text("Последние действия", fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
    }
    if (events.isEmpty()) Text("Пока без изменений. Выдачи и изменения ролей появятся здесь.", color = Muted, fontSize = 13.sp, modifier = Modifier.padding(top = 10.dp))
    events.forEachIndexed { index, event ->
        if (index > 0) HairlineDivider()
        Column(Modifier.padding(vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(eventTitle(event), fontSize = 14.sp, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
                Text(
                    java.text.SimpleDateFormat("d MMM, HH:mm", java.util.Locale("ru")).format(java.util.Date(event.optLong("created"))),
                    color = Muted, fontSize = 12.sp,
                )
            }
            val handle = event.optString("handle")
            Text(
                if (event.optString("action") == "marketIssue") event.optString("actorName")
                else "${event.optString("actorName")} → ${if (handle.isNotEmpty()) "@$handle" else event.optString("name")}",
                color = Secondary, fontSize = 13.sp,
            )
            event.optString("reason").takeIf { it.isNotBlank() }?.let { Text(it, color = Muted, fontSize = 13.sp, lineHeight = 18.sp) }
            if (event.optString("action") == "collectible") giftDetails(event).takeIf { it.isNotEmpty() }?.let { Text(it, color = Muted, fontSize = 12.sp) }
        }
    }
}
