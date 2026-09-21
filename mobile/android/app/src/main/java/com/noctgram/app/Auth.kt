package com.noctgram.app

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONObject

@Composable
private fun AuthFrame(title: String, subtitle: String, content: @Composable () -> Unit) = Column(
    Modifier.fillMaxSize().systemBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(24.dp),
    verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically),
    horizontalAlignment = Alignment.CenterHorizontally,
) {
    Image(painterResource(R.drawable.noct_logo), contentDescription = null, modifier = Modifier.size(72.dp))
    Text(title, fontSize = 29.sp, fontWeight = FontWeight.Medium, letterSpacing = (-1.2).sp)
    Text(subtitle, color = Muted, textAlign = TextAlign.Center)
    content()
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

    AuthFrame(
        "noctgram",
        if (codeStep) "Код отправлен на ${email.trim()}" else "Войдите по коду из письма. Пароль не нужен.",
    ) {
        if (!model.emailEnabled) Text("Вход по почте сейчас недоступен на сервере.", color = Danger, textAlign = TextAlign.Center)
        if (!codeStep) {
            OutlinedTextField(
                email, { email = it.take(254) },
                label = { Text("Почта") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Go),
                keyboardActions = KeyboardActions(onGo = { sendCode() }),
                modifier = Modifier.fillMaxWidth(),
            )
            PrimaryButton("Получить код", enabled = !busy && model.emailEnabled && "@" in email, modifier = Modifier.fillMaxWidth(), onClick = sendCode)
        } else {
            OutlinedTextField(
                code, { code = it.filter(Char::isDigit).take(6) },
                label = { Text("Код из письма") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Go),
                keyboardActions = KeyboardActions(onGo = { if (code.length == 6) verify() }),
                modifier = Modifier.fillMaxWidth(),
            )
            PrimaryButton("Войти", enabled = !busy && code.length == 6, modifier = Modifier.fillMaxWidth(), onClick = verify)
            TextButton(onClick = { codeStep = false; error = "" }) { Text("Другая почта", color = Body) }
        }
        if (error.isNotEmpty()) Text(error, color = Danger, textAlign = TextAlign.Center)
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
    AuthFrame("Добро пожаловать", "Как вас будут видеть в Noctgram") {
        OutlinedTextField(name, { name = it.take(40) }, label = { Text("Имя") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(
            handle, { handle = it.removePrefix("@").lowercase().take(24) },
            label = { Text("Юзернейм") },
            supportingText = { Text("4–24 латинские буквы, цифры или _") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        PrimaryButton("Продолжить", enabled = valid && !busy, modifier = Modifier.fillMaxWidth()) {
            busy = true
            error = ""
            scope.launch {
                try {
                    model.api.post("/api/auth/onboarding", JSONObject().put("name", name.trim()).put("handle", handle))
                    model.refresh()
                } catch (failure: ApiException) { error = failure.message.orEmpty() }
                busy = false
            }
        }
        if (error.isNotEmpty()) Text(error, color = Danger, textAlign = TextAlign.Center)
        TextButton(onClick = { model.signOut() }) { Text("Выйти", color = Body) }
    }
}
