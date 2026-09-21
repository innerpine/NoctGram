package com.noctgram.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** One of the two cookies NoctGram issues. Everything else the server sends is ignored. */
data class SessionCookie(val name: String, val value: String, val expiresAt: Long) {
    fun valid(now: Long) = name in NAMES && HEX64.matches(value) && expiresAt > now

    companion object {
        const val SESSION = "noct_session"
        val NAMES = setOf(SESSION, "noct_email_challenge")
        private val HEX64 = Regex("^[a-f0-9]{64}$")

        /**
         * Parses a Set-Cookie header written by the server's authCookie():
         * `name=value; Path=/; HttpOnly; SameSite=Lax; Max-Age=N; Secure`.
         * Returns null for anything that is not ours or not safe to keep. An
         * empty value or Max-Age<=0 yields expiresAt=0, which means "delete".
         */
        fun parse(header: String, now: Long): SessionCookie? {
            val parts = header.split(';').map { it.trim() }
            val pair = parts.firstOrNull()?.split('=', limit = 2) ?: return null
            if (pair.size != 2 || pair[0] !in NAMES) return null
            val attributes = parts.drop(1).associate {
                val kv = it.split('=', limit = 2)
                kv[0].lowercase() to kv.getOrElse(1) { "" }
            }
            if ("secure" !in attributes || attributes["path"] != "/") return null
            val domain = attributes["domain"]?.trim('.')?.lowercase()
            if (domain != null && domain != "noctgram.com") return null
            val maxAge = attributes["max-age"]?.toLongOrNull() ?: return null
            if (pair[1].isEmpty() || maxAge <= 0) return SessionCookie(pair[0], "", 0)
            return SessionCookie(pair[0], pair[1], now + maxAge * 1000).takeIf { it.valid(now) }
        }
    }
}

/** Where the cookies survive a restart. The API client only sees this interface, so tests use memory. */
interface SessionStore {
    fun read(): List<SessionCookie>
    fun write(cookies: List<SessionCookie>)
}

class MemorySessionStore : SessionStore {
    private var saved = emptyList<SessionCookie>()
    override fun read() = saved
    override fun write(cookies: List<SessionCookie>) { saved = cookies }
}

/**
 * Cookies encrypted with an AES-GCM key that never leaves the Android Keystore,
 * the counterpart of the iOS Keychain item. The preferences file is excluded
 * from backups in the manifest. A key or ciphertext that cannot be read (new
 * device, restored data) simply means "signed out".
 */
class KeystoreSessionStore(context: Context) : SessionStore {
    private val prefs = context.getSharedPreferences("noctgram-session", Context.MODE_PRIVATE)

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(
                KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .build(),
            )
            generateKey()
        }
    }

    override fun read(): List<SessionCookie> = try {
        val sealed = Base64.decode(prefs.getString(FIELD, "") ?: "", Base64.NO_WRAP)
        if (sealed.size <= IV) emptyList() else {
            val cipher = Cipher.getInstance(AES_GCM)
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, sealed, 0, IV))
            val json = JSONArray(String(cipher.doFinal(sealed, IV, sealed.size - IV), Charsets.UTF_8))
            val now = System.currentTimeMillis()
            (0 until json.length()).map { json.getJSONObject(it) }
                .map { SessionCookie(it.getString("name"), it.getString("value"), it.getLong("expiresAt")) }
                .filter { it.valid(now) }
        }
    } catch (_: Exception) {
        emptyList()
    }

    override fun write(cookies: List<SessionCookie>) {
        if (cookies.isEmpty()) {
            prefs.edit().remove(FIELD).apply()
            return
        }
        val json = JSONArray(cookies.map {
            JSONObject().put("name", it.name).put("value", it.value).put("expiresAt", it.expiresAt)
        }).toString()
        val cipher = Cipher.getInstance(AES_GCM).apply { init(Cipher.ENCRYPT_MODE, key()) }
        val sealed = cipher.iv + cipher.doFinal(json.toByteArray(Charsets.UTF_8))
        prefs.edit().putString(FIELD, Base64.encodeToString(sealed, Base64.NO_WRAP)).apply()
    }

    private companion object {
        const val ALIAS = "noctgram-session-key"
        const val FIELD = "cookies"
        const val AES_GCM = "AES/GCM/NoPadding"
        const val IV = 12
    }
}
