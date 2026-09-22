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
internal fun SectionTitle(text: String, modifier: Modifier = Modifier) =
    Text(text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.2).sp, modifier = modifier)

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
