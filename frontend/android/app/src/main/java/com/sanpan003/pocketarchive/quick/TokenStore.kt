package com.sanpan003.pocketarchive.quick

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.sanpan003.pocketarchive.BuildConfig
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Device token + server settings shared by the web layer and native code.
 * The token is encrypted with an AES-256 key that lives in the Android
 * Keystore (never leaves secure hardware), and only the ciphertext is stored.
 *
 * App lock (AppLock.kt): the full token moves behind a fingerprint-bound key; this store then keeps only the
 * CAPTURE-ONLY token, and token() returns the full token while unlocked, else the capture token.
 */
object TokenStore {
    private const val PREFS = "pocket_archive_secure"
    private const val KEY_ALIAS = "pocket_archive_device_token"
    private const val PREF_TOKEN = "token"
    private const val PREF_CAPTURE = "capture_token"
    private const val PREF_API_BASE = "api_base"
    private const val PREF_FEEDBACK = "feedback"
    private const val PREF_VOLUME_STOP = "volume_stop"
    private const val PREF_LAUNCHER_TOGGLE = "launcher_toggle"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"

    @Volatile private var cachedToken: String? = null
    @Volatile private var cachedCapture: String? = null
    @Volatile private var captureLoaded = false
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

    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        return "${b64(cipher.iv)}:${b64(encrypted)}"
    }
    private fun decrypt(stored: String?): String? = stored?.let {
        runCatching {
            val (iv, data) = it.split(":", limit = 2)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, unb64(iv)))
            String(cipher.doFinal(unb64(data)), Charsets.UTF_8)
        }.getOrNull()
    }

    /** Sign in / sign out (null). Signing out also ends the app lock. */
    @Synchronized
    fun setToken(ctx: Context, token: String?) {
        if (token.isNullOrEmpty()) {
            AppLock.reset(ctx)
            setCaptureToken(ctx, null)
        }
        setPlain(ctx, token)
    }

    /** The full token kept by this store (app lock off) */
    @Synchronized
    fun setPlain(ctx: Context, token: String?) {
        val editor = prefs(ctx).edit()
        if (token.isNullOrEmpty()) editor.remove(PREF_TOKEN) else editor.putString(PREF_TOKEN, encrypt(token))
        editor.commit()
        cachedToken = token?.takeIf { it.isNotEmpty() }
        loaded = true
    }

    @Synchronized
    fun plainToken(ctx: Context): String? {
        if (loaded) return cachedToken
        cachedToken = decrypt(prefs(ctx).getString(PREF_TOKEN, null))
        loaded = true
        return cachedToken
    }

    /** App lock: the capture-only token (uploads and reports, never reading notes) */
    @Synchronized
    fun setCaptureToken(ctx: Context, token: String?) {
        val editor = prefs(ctx).edit()
        if (token.isNullOrEmpty()) editor.remove(PREF_CAPTURE) else editor.putString(PREF_CAPTURE, encrypt(token))
        editor.commit()
        cachedCapture = token?.takeIf { it.isNotEmpty() }
        captureLoaded = true
    }

    @Synchronized
    fun captureToken(ctx: Context): String? {
        if (captureLoaded) return cachedCapture
        cachedCapture = decrypt(prefs(ctx).getString(PREF_CAPTURE, null))
        captureLoaded = true
        return cachedCapture
    }

    /** The token to use right now: app lock on → the full one while unlocked, else the capture-only one */
    fun token(ctx: Context): String? =
        if (AppLock.enabled(ctx)) AppLock.unlockedToken(ctx) ?: captureToken(ctx) else plainToken(ctx)

    /** For things that leave the phone or run unattended (the watch): never the full token while the lock is on */
    fun backgroundToken(ctx: Context): String? = if (AppLock.enabled(ctx)) captureToken(ctx) else plainToken(ctx)

    /** Signed in at all (with or without the app lock) */
    fun signedIn(ctx: Context): Boolean = token(ctx) != null

    // ── Accounts: whose token this is ─────────────────────────────────────
    // userId = signed-in user; lastUserId = who was signed in last (recordings made while
    // signed out belong to them, never to the next person who signs in)
    fun userId(ctx: Context): String? = prefs(ctx).getString("user_id", null)
    fun lastUserId(ctx: Context): String? = prefs(ctx).getString("last_user_id", null)
    fun setUserId(ctx: Context, userId: String?) {
        val e = prefs(ctx).edit()
        if (userId == null) e.remove("user_id") else e.putString("user_id", userId).putString("last_user_id", userId)
        e.commit()
    }

    fun setApiBase(ctx: Context, apiBase: String?) {
        prefs(ctx).edit().putString(PREF_API_BASE, apiBase?.trimEnd('/')).apply()
    }

    fun apiBase(ctx: Context): String? =
        prefs(ctx).getString(PREF_API_BASE, null)?.takeIf { it.isNotBlank() }
            ?: BuildConfig.API_BASE.trimEnd('/').takeIf { it.isNotBlank() }

    /** "Sound & vibration" setting from the app (default on). */
    fun setFeedbackEnabled(ctx: Context, enabled: Boolean) {
        prefs(ctx).edit().putBoolean(PREF_FEEDBACK, enabled).apply()
    }

    fun feedbackEnabled(ctx: Context): Boolean = prefs(ctx).getBoolean(PREF_FEEDBACK, true)

    /** "Volume down stops recording" (default on). */
    fun setVolumeStop(ctx: Context, enabled: Boolean) {
        prefs(ctx).edit().putBoolean(PREF_VOLUME_STOP, enabled).apply()
    }

    fun volumeStop(ctx: Context): Boolean = prefs(ctx).getBoolean(PREF_VOLUME_STOP, true)

    /** "Quick Record stops a running recording" (default on). */
    fun setLauncherToggle(ctx: Context, enabled: Boolean) {
        prefs(ctx).edit().putBoolean(PREF_LAUNCHER_TOGGLE, enabled).apply()
    }

    fun launcherToggle(ctx: Context): Boolean = prefs(ctx).getBoolean(PREF_LAUNCHER_TOGGLE, true)

    private fun b64(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.NO_WRAP)
    private fun unb64(text: String) = Base64.decode(text, Base64.NO_WRAP)
}
