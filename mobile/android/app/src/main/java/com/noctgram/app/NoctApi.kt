package com.noctgram.app

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.atomic.AtomicInteger

class ApiException(
    val status: Int,
    val code: String,
    message: String,
    val retryAfter: Int? = null,
) : Exception(message) {
    val unauthorized get() = status == 401
    val onboardingRequired get() = code == "ONBOARDING_REQUIRED"
}

class HttpRequest(val method: String, val url: String, val headers: Map<String, String>, val body: ByteArray?)
class HttpResponse(val status: Int, val headers: Map<String, List<String>>, val body: ByteArray) {
    fun header(name: String) = headers.entries.firstOrNull { it.key.equals(name, true) }?.value?.firstOrNull()
    fun all(name: String) = headers.entries.filter { it.key.equals(name, true) }.flatMap { it.value }
}

/** The network seam: production uses HttpURLConnection, tests answer from memory. */
fun interface Transport {
    @Throws(IOException::class)
    fun send(request: HttpRequest, maxBytes: Int): HttpResponse
}

class UrlConnectionTransport : Transport {
    override fun send(request: HttpRequest, maxBytes: Int): HttpResponse {
        val connection = URL(request.url).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = request.method
            // The API never redirects; following one could carry the session elsewhere.
            connection.instanceFollowRedirects = false
            connection.useCaches = false
            connection.connectTimeout = 15_000
            connection.readTimeout = 30_000
            request.headers.forEach(connection::setRequestProperty)
            request.body?.let {
                connection.doOutput = true
                connection.setFixedLengthStreamingMode(it.size)
                connection.outputStream.use { out -> out.write(it) }
            }
            val status = connection.responseCode
            val stream = if (status >= 400) connection.errorStream else connection.inputStream
            // Bounded read: a huge or hostile body is cut off, never buffered whole.
            val body = ByteArrayOutputStream()
            stream?.use { input ->
                val chunk = ByteArray(16 * 1024)
                while (true) {
                    val read = input.read(chunk)
                    if (read < 0) break
                    if (body.size() + read > maxBytes) throw IOException("Response exceeds $maxBytes bytes")
                    body.write(chunk, 0, read)
                }
            }
            return HttpResponse(status, connection.headerFields.filterKeys { it != null }, body.toByteArray())
        } finally {
            connection.disconnect()
        }
    }
}

/**
 * Client for the NoctGram server, the counterpart of the iOS NoctAPI: one fixed
 * HTTPS origin, /api/ paths only, the session kept as two validated cookies.
 */
class NoctApi(
    private val store: SessionStore,
    private val transport: Transport = UrlConnectionTransport(),
    private val now: () -> Long = System::currentTimeMillis,
) {
    /** Called (on a background thread) when the server rejects the stored session. */
    var onSessionExpired: (() -> Unit)? = null

    private val lock = Any()
    private val cookies = store.read().associateBy { it.name }.toMutableMap()
    // A response that started before sign-out must not bring the old session back.
    private val generation = AtomicInteger()

    val hasSession get() = synchronized(lock) { cookies[SessionCookie.SESSION]?.valid(now()) == true }

    suspend fun get(path: String, query: Map<String, String> = emptyMap()) = json("GET", path, query, null)
    suspend fun post(path: String, body: JSONObject) = json("POST", path, emptyMap(), body)

    /** Media is served only to the signed-in account, so images go through here too. */
    suspend fun download(path: String, maxBytes: Int = MEDIA_LIMIT): ByteArray =
        send("GET", path.removePrefix(ORIGIN), emptyMap(), null, "*/*", maxBytes).body

    fun clearSession() {
        generation.incrementAndGet()
        synchronized(lock) { cookies.clear() }
        store.write(emptyList())
    }

    private suspend fun json(method: String, path: String, query: Map<String, String>, body: JSONObject?): JSONObject {
        val response = send(method, path, query, body, "application/json", JSON_LIMIT)
        if (response.status == 204 && response.body.isEmpty()) return JSONObject()
        val value = response.takeIf { it.header("Content-Type").orEmpty().contains("json", true) }
            ?.let { runCatching { JSONTokener(String(it.body, Charsets.UTF_8)).nextValue() }.getOrNull() }
        return when (value) {
            is JSONObject -> value
            // Lists (the feed, comments) arrive bare; give them one shape, as the iOS client does.
            is JSONArray -> JSONObject().put("items", value)
            else -> throw ApiException(response.status, "INVALID_RESPONSE", "Сервер вернул неожиданный ответ. Попробуйте ещё раз.")
        }
    }

    private suspend fun send(
        method: String,
        path: String,
        query: Map<String, String>,
        body: JSONObject?,
        accept: String,
        maxBytes: Int,
    ): HttpResponse = withContext(Dispatchers.IO) {
        val started = generation.get()
        val headers = mutableMapOf(
            // The auth routes require a same-origin Origin header; the rest accept it.
            "Origin" to ORIGIN,
            "Accept" to accept,
            "Cache-Control" to "no-store",
            "User-Agent" to "NoctGram-Android",
        )
        val cookie = synchronized(lock) {
            cookies.values.filter { it.valid(now()) }.joinToString("; ") { "${it.name}=${it.value}" }
        }
        if (cookie.isNotEmpty()) headers["Cookie"] = cookie
        if (body != null) headers["Content-Type"] = "application/json"
        val response = try {
            transport.send(HttpRequest(method, apiUrl(path, query), headers, body?.toString()?.toByteArray()), maxBytes)
        } catch (_: SocketTimeoutException) {
            throw ApiException(0, "TIMEOUT", "Сервер не ответил вовремя. Повторите запрос.")
        } catch (_: IOException) {
            throw ApiException(0, "NETWORK", "Не удалось подключиться к NoctGram. Проверьте интернет.")
        }
        if (generation.get() == started) capture(response)
        if (response.status !in 200..299) {
            val failure = apiError(response)
            if (failure.unauthorized && path !in AUTH_STEPS) {
                clearSession()
                onSessionExpired?.invoke()
            }
            throw failure
        }
        response
    }

    private fun capture(response: HttpResponse) {
        val fresh = response.all("Set-Cookie").mapNotNull { SessionCookie.parse(it, now()) }
        if (fresh.isEmpty()) return
        val saved = synchronized(lock) {
            for (item in fresh) if (item.expiresAt == 0L) cookies.remove(item.name) else cookies[item.name] = item
            cookies.values.toList()
        }
        store.write(saved)
    }

    companion object {
        const val ORIGIN = "https://noctgram.com"
        const val JSON_LIMIT = 8 * 1024 * 1024
        const val MEDIA_LIMIT = 25 * 1024 * 1024
        // A wrong code is a 401 too, and must not sign the device out.
        private val AUTH_STEPS = setOf("/api/auth/start", "/api/auth/verify")
        private val SAFE_PATH = Regex("^/api/[A-Za-z0-9._~/-]+$")

        /** Builds the request URL, refusing anything that is not a plain /api/ path on our origin. */
        fun apiUrl(path: String, query: Map<String, String> = emptyMap()): String {
            if (!SAFE_PATH.matches(path) || ".." in path || "//" in path)
                throw ApiException(0, "UNSAFE_URL", "Запрос за пределы NoctGram запрещён.")
            val search = query.toSortedMap().entries.joinToString("&") {
                URLEncoder.encode(it.key, "UTF-8") + "=" + URLEncoder.encode(it.value, "UTF-8")
            }
            return ORIGIN + path + if (search.isEmpty()) "" else "?$search"
        }

        fun apiError(response: HttpResponse): ApiException {
            val body = runCatching { JSONObject(String(response.body, Charsets.UTF_8)) }.getOrNull()
            val fallback = when {
                response.status == 401 -> "Войдите в NoctGram, чтобы продолжить."
                response.status == 429 -> "Слишком много запросов. Подождите немного."
                response.status >= 500 -> "Сервер временно недоступен. Попробуйте позже."
                else -> "Не удалось выполнить запрос."
            }
            return ApiException(
                response.status,
                body?.optString("code").orEmpty().ifEmpty { "HTTP_${response.status}" }.take(100),
                body?.optString("error").orEmpty().ifEmpty { fallback }.take(700),
                response.header("Retry-After")?.toIntOrNull() ?: body?.optInt("retryAfter")?.takeIf { it > 0 },
            )
        }
    }
}
