package com.noctgram.app

import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

private const val NOW = 1_000_000L
private val TOKEN = "ab".repeat(32)

/** Answers every request from memory and remembers what was asked. */
private class FakeTransport(val answer: (HttpRequest) -> HttpResponse) : Transport {
    val seen = mutableListOf<HttpRequest>()
    override fun send(request: HttpRequest, maxBytes: Int) = answer(request).also { seen += request }
}

private fun json(status: Int, body: String, vararg cookies: String) = HttpResponse(
    status,
    mapOf("Content-Type" to listOf("application/json"), "Set-Cookie" to cookies.toList()),
    body.toByteArray(),
)

class NoctApiTest {
    @Test fun `only our own safe cookies are kept`() {
        val good = SessionCookie.parse("noct_session=$TOKEN; Path=/; HttpOnly; SameSite=Lax; Max-Age=60; Secure", NOW)
        assertEquals(SessionCookie("noct_session", TOKEN, NOW + 60_000), good)
        for (bad in listOf(
            "other=$TOKEN; Path=/; Max-Age=60; Secure",                       // not ours
            "noct_session=$TOKEN; Path=/; Max-Age=60",                        // not Secure
            "noct_session=$TOKEN; Path=/chat; Max-Age=60; Secure",            // wrong path
            "noct_session=$TOKEN; Path=/; Max-Age=60; Secure; Domain=evil.com",
            "noct_session=short; Path=/; Max-Age=60; Secure",                 // not a token
            "noct_session=$TOKEN; Path=/; Secure",                            // no lifetime
        )) assertNull(bad, SessionCookie.parse(bad, NOW))
        assertEquals(0L, SessionCookie.parse("noct_session=; Path=/; Max-Age=0; Secure", NOW)?.expiresAt)
    }

    @Test fun `requests cannot leave the api of our origin`() {
        assertEquals("https://noctgram.com/api/social?action=feed&mode=all",
            NoctApi.apiUrl("/api/social", mapOf("mode" to "all", "action" to "feed")))
        assertEquals("https://noctgram.com/api/social?q=a%26b%3Dc", NoctApi.apiUrl("/api/social", mapOf("q" to "a&b=c")))
        for (bad in listOf("/login", "https://evil.com/api/x", "/api/../admin", "/api//x", "/api/x?y=1", "/api/x#f", "/api/x\\y", "//evil.com/api/x"))
            assertThrows(bad, ApiException::class.java) { NoctApi.apiUrl(bad) }
    }

    @Test fun `sign-in stores the session, sends it back and survives a restart`() = runBlocking {
        val store = MemorySessionStore()
        val transport = FakeTransport { request ->
            if (request.url.endsWith("/api/auth/verify"))
                json(200, "{\"redirectTo\":\"/\"}",
                    "noct_session=$TOKEN; Path=/; HttpOnly; SameSite=Lax; Max-Age=600; Secure",
                    "noct_email_challenge=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure")
            else json(200, "[{\"id\":\"p1\"}]")
        }
        val api = NoctApi(store, transport) { NOW }
        assertFalse(api.hasSession)
        api.post("/api/auth/verify", JSONObject().put("code", "123456"))
        assertTrue(api.hasSession)
        assertEquals("https://noctgram.com", transport.seen.last().headers["Origin"])
        // A bare list gets one shape, and the cookie travels with the next request.
        assertEquals("p1", api.get("/api/social", mapOf("action" to "feed")).objects("items").single().getString("id"))
        assertEquals("noct_session=$TOKEN", transport.seen.last().headers["Cookie"])
        assertTrue(NoctApi(store, transport) { NOW }.hasSession)
        assertFalse(NoctApi(store, transport) { NOW + 601_000 }.hasSession)
    }

    @Test fun `a rejected session signs the device out, a wrong code does not`() = runBlocking {
        val store = MemorySessionStore().apply { write(listOf(SessionCookie("noct_session", TOKEN, NOW + 60_000))) }
        var expired = 0
        val api = NoctApi(store, FakeTransport { json(401, "{\"error\":\"Неверный код\",\"code\":\"BAD_CODE\"}") }) { NOW }
        api.onSessionExpired = { expired++ }
        val wrongCode = runCatching { api.post("/api/auth/verify", JSONObject()) }.exceptionOrNull() as ApiException
        assertEquals("Неверный код", wrongCode.message)
        assertEquals("BAD_CODE", wrongCode.code)
        assertTrue(api.hasSession)
        assertTrue((runCatching { api.get("/api/social") }.exceptionOrNull() as ApiException).unauthorized)
        assertFalse(api.hasSession)
        assertEquals(1, expired)
        assertTrue(store.read().isEmpty())
    }

    @Test fun `errors are readable and non-json is refused`() = runBlocking {
        val limited = NoctApi.apiError(HttpResponse(429, mapOf("Retry-After" to listOf("30")), ByteArray(0)))
        assertEquals("Слишком много запросов. Подождите немного.", limited.message)
        assertEquals(30, limited.retryAfter)
        val html = NoctApi(MemorySessionStore(), FakeTransport {
            HttpResponse(200, mapOf("Content-Type" to listOf("text/html")), "<html>".toByteArray())
        })
        assertEquals("INVALID_RESPONSE", (runCatching { html.get("/api/social") }.exceptionOrNull() as ApiException).code)
    }

    @Test fun `uploads are multipart, bound to a chat when asked, and refuse unsafe input`() = runBlocking {
        val transport = FakeTransport { json(200, "{\"id\":\"file1\"}") }
        val api = NoctApi(MemorySessionStore(), transport)
        assertEquals("file1", api.upload(byteArrayOf(1, 2, 3), "C:\\photos\\me\"1.png", "image/png", chatPeer = "bob").getString("id"))
        val sent = transport.seen.single()
        assertEquals("https://noctgram.com/api/chat-upload", sent.url)
        assertTrue(sent.headers.getValue("Content-Type").startsWith("multipart/form-data; boundary=NoctGram-"))
        val body = String(sent.body!!, Charsets.ISO_8859_1)
        // Only the file name survives: no path, no quote that could break the header.
        assertTrue(body.contains("filename=\"me1.png\""))
        assertTrue(body.contains("name=\"peer\"\r\n\r\nbob\r\n"))
        assertEquals("https://noctgram.com/api/upload", run {
            api.upload(byteArrayOf(1), "a.jpg", "image/jpeg")
            transport.seen.last().url
        })
        for (bad in listOf<suspend () -> Any>(
            { api.upload(ByteArray(0), "a.jpg", "image/jpeg") },
            { api.upload(byteArrayOf(1), "a.jpg", "not a mime") },
            { api.upload(byteArrayOf(1), "a.jpg", "image/jpeg", chatPeer = "bob\r\nX: y") },
        )) assertTrue(runCatching { bad() }.exceptionOrNull() is ApiException)
        assertEquals(2, transport.seen.size)
    }

    @Test fun `timestamps are compact`() {
        val now = 10L * 24 * 60 * 60_000
        assertEquals("сейчас", relativeTime(now - 20_000, now))
        assertEquals("5 мин", relativeTime(now - 5 * 60_000, now))
        assertEquals("3 ч", relativeTime(now - 3 * 60 * 60_000, now))
        assertEquals("2 д", relativeTime(now - 2L * 24 * 60 * 60_000, now))
        assertEquals("12 500", groupedNumber(12_500))
    }
}
