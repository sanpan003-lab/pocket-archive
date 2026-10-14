package com.sanpan003.pocketarchive.quick

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Device token + server settings shared by the web layer and native code.
 * The token is encrypted with an AES-256 key that lives in the Android
 * Keystore (never leaves secure hardware), and only the ciphertext is stored.
 */
object TokenStore {
    private const val PREFS = "pocket_archive_secure"
    private const val KEY_ALIAS = "pocket_archive_device_token"
    private const val PREF_TOKEN = "token"
    private const val PREF_API_BASE = "api_base"
    private const val PREF_FEEDBACK = "feedback"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"

    @Volatile private var cachedToken: String? = null
    @Volatile private var loaded = false

    private fun prefs(ctx: Context) =
        ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return generator.generateKey()
    }

    @Synchronized
    fun setToken(ctx: Context, token: String?) {
        val editor = prefs(ctx).edit()
        if (token.isNullOrEmpty()) {
            editor.remove(PREF_TOKEN)
        } else {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.ENCRYPT_MODE, secretKey())
            val encrypted = cipher.doFinal(token.toByteArray(Charsets.UTF_8))
            editor.putString(PREF_TOKEN, "${b64(cipher.iv)}:${b64(encrypted)}")
        }
        editor.commit()
        cachedToken = token?.takeIf { it.isNotEmpty() }
        loaded = true
    }

    @Synchronized
    fun token(ctx: Context): String? {
        if (loaded) return cachedToken
        cachedToken = prefs(ctx).getString(PREF_TOKEN, null)?.let { stored ->
            runCatching {
                val (iv, data) = stored.split(":", limit = 2)
                val cipher = Cipher.getInstance(TRANSFORMATION)
                cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, unb64(iv)))
                String(cipher.doFinal(unb64(data)), Charsets.UTF_8)
            }.getOrNull()
        }
        loaded = true
        return cachedToken
    }

    fun setApiBase(ctx: Context, apiBase: String?) {
        prefs(ctx).edit().putString(PREF_API_BASE, apiBase?.trimEnd('/')).apply()
    }

    fun apiBase(ctx: Context): String? = prefs(ctx).getString(PREF_API_BASE, null)?.takeIf { it.isNotBlank() }

    /** "Sound & vibration" setting from the app (default on). */
    fun setFeedbackEnabled(ctx: Context, enabled: Boolean) {
        prefs(ctx).edit().putBoolean(PREF_FEEDBACK, enabled).apply()
    }

    fun feedbackEnabled(ctx: Context): Boolean = prefs(ctx).getBoolean(PREF_FEEDBACK, true)

    private fun b64(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.NO_WRAP)
    private fun unb64(text: String) = Base64.decode(text, Base64.NO_WRAP)
}
