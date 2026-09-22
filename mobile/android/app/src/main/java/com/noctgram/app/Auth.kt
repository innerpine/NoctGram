package com.noctgram.app

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONObject

@Composable
private fun AuthFrame(subtitle: String, title: String? = null, content: @Composable () -> Unit) = Column(
    Modifier.fillMaxSize().systemBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 24.dp),
    verticalArrangement = Arrangement.Center,
    horizontalAlignment = Alignment.CenterHorizontally,
) {
    Image(painterResource(R.drawable.noct_logo), contentDescription = null, modifier = Modifier.size(64.dp))
    Spacer(Modifier.height(12.dp))
    if (title == null) Wordmark(38.sp) else Text(title, fontSize = 28.sp, letterSpacing = (-1).sp, textAlign = TextAlign.Center)
    Text(subtitle, color = Muted, fontSize = 15.sp, lineHeight = 22.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 8.dp, bottom = 28.dp))
    Column(
        Modifier.fillMaxWidth().noctCard(RoundedCornerShape(20.dp)).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) { content() }
}

/** Sign-in by a one-time code from email: the address first, then the six digits. */
@Composable
fun LoginScreen(model: AppModel) {
    val scope = rememberCoroutineScope()
    var email by rememberSaveable { mutableStateOf(model.pendingEmail) }
    var codeStep by rememberSaveable { mutableStateOf(model.pendingEmail.isNotEmpty()) }
    var code by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    fun run(block: suspend () -> Unit) {
        if (busy) return
        busy = true
        error = ""
        scope.launch {
            try { block() } catch (failure: ApiException) { error = failure.message.orEmpty() }
            busy = false
        }
    }
    val sendCode = { run { model.api.post("/api/auth/start", JSONObject().put("email", email.trim())); code = ""; codeStep = true } }
    val verify = { run { model.api.post("/api/auth/verify", JSONObject().put("code", code)); model.refresh() } }

    AuthFrame(if (codeStep) "Код отправлен на ${email.trim()}" else "Свои люди. Твои мысли.\nВход по коду из письма, пароль не нужен.") {
        if (!model.emailEnabled) ErrorNote("Вход по почте сейчас недоступен на сервере.")
        if (!codeStep) {
            NoctField(
                email, { email = it.take(254) },
                label = "Почта",
                placeholder = "name@example.com",
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Go),
                keyboardActions = KeyboardActions(onGo = { sendCode() }),
            )
            NoctButton(if (busy) "Отправляем…" else "Получить код", sendCode, Modifier.fillMaxWidth(), enabled = !busy && model.emailEnabled && "@" in email)
        } else {
            NoctField(
                code, { code = it.filter(Char::isDigit).take(6) },
                label = "Код из письма",
                placeholder = "000000",
                singleLine = true,
                textStyle = TextStyle(fontFamily = Inter, fontSize = 22.sp, letterSpacing = 8.sp),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Go),
                keyboardActions = KeyboardActions(onGo = { if (code.length == 6) verify() }),
            )
            NoctButton(if (busy) "Проверяем…" else "Войти", verify, Modifier.fillMaxWidth(), enabled = !busy && code.length == 6)
            NoctButton("Другая почта", { codeStep = false; error = "" }, Modifier.fillMaxWidth(), tone = Tone.Quiet)
        }
        if (error.isNotEmpty()) ErrorNote(error)
    }
}

/** First sign-in: the account needs a name and a username before anything else works. */
@Composable
fun OnboardingScreen(model: AppModel) {
    val scope = rememberCoroutineScope()
    var name by rememberSaveable { mutableStateOf("") }
    var handle by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    val valid = name.isNotBlank() && Regex("^[a-z0-9_]{4,24}$").matches(handle)
    AuthFrame("Как вас будут видеть в Noctgram", title = "Добро пожаловать") {
        NoctField(name, { name = it.take(40) }, label = "Имя", placeholder = "Имя и фамилия или псевдоним", singleLine = true)
        NoctField(
            handle, { handle = it.removePrefix("@").lowercase().take(24) },
            label = "Юзернейм",
            placeholder = "username",
            hint = "4–24 латинские буквы, цифры или _",
            singleLine = true,
        )
        NoctButton(if (busy) "Сохраняем…" else "Продолжить", {
            busy = true
            error = ""
            scope.launch {
                try {
                    model.api.post("/api/auth/onboarding", JSONObject().put("name", name.trim()).put("handle", handle))
                    model.refresh()
                } catch (failure: ApiException) { error = failure.message.orEmpty() }
                busy = false
            }
        }, Modifier.fillMaxWidth(), enabled = valid && !busy)
        if (error.isNotEmpty()) ErrorNote(error)
        NoctButton("Выйти", { model.signOut() }, Modifier.fillMaxWidth(), tone = Tone.Quiet)
    }
}
