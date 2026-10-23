package com.sanpan003.pocketarchive.quick

import android.content.Context
import android.os.Build
import android.os.SystemClock
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * App lock (2.7.0, per device, off by default). The full device token — the one that can read notes — is encrypted
 * with a Keystore key that needs the fingerprint (or the phone's PIN) within the last 30 s, and is invalidated when a
 * new fingerprint is added. After unlocking it lives in memory only; it's dropped when the app has been in the
 * background longer than the chosen time (every open / 1 / 5 / 15 min).
 *
 * While locked, native code gets the CAPTURE-ONLY token (TokenStore.token): recordings, scans, the widget, the tile,
 * the watch relay and update checks keep working, but nothing can read notes, and notifications only say "Saved".
 */
object AppLock {
    private const val PREFS = "app_lock"
    private const val KEY_ALIAS = "pocket_archive_lock_key"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    const val AUTH_SECONDS = 30
    val TIMEOUTS = setOf(0, 1, 5, 15)

    @Volatile private var fullToken: String? = null
    @Volatile var inForeground = false
        private set
    @Volatile private var backgroundAt = 0L
    /** A prompt (or the PIN screen) is open: leaving the activity for it isn't "going to the background" */
    @Volatile var prompting = false

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun enabled(ctx: Context) = prefs(ctx).getBoolean("enabled", false)
    fun timeoutMin(ctx: Context) = prefs(ctx).getInt("timeoutMin", 5).takeIf { it in TIMEOUTS } ?: 5
    fun secure(ctx: Context) = prefs(ctx).getBoolean("secure", true)
    fun setTimeout(ctx: Context, min: Int) { if (min in TIMEOUTS) prefs(ctx).edit().putInt("timeoutMin", min).apply() }
    fun setSecure(ctx: Context, on: Boolean) = prefs(ctx).edit().putBoolean("secure", on).apply()

    /** Pure rule (unit tested): has the app been away long enough to lock again? */
    fun timedOut(backgroundAt: Long, now: Long, timeoutMin: Int): Boolean =
        backgroundAt > 0 && now - backgroundAt >= timeoutMin * 60_000L

    /** The full token when unlocked (null when locked or the lock is off) */
    fun unlockedToken(ctx: Context): String? {
        if (!enabled(ctx)) return null
        if (!inForeground && timedOut(backgroundAt, SystemClock.elapsedRealtime(), timeoutMin(ctx))) fullToken = null
        return fullToken
    }

    fun isLocked(ctx: Context) = enabled(ctx) && unlockedToken(ctx) == null

    /** Activity resumed → true when the lock screen must show */
    fun onForeground(ctx: Context): Boolean {
        unlockedToken(ctx)          // applies the timeout
        inForeground = true
        backgroundAt = 0
        return isLocked(ctx)
    }

    fun onBackground() {
        if (prompting) return
        inForeground = false
        backgroundAt = SystemClock.elapsedRealtime()
    }

    fun lockNow() { fullToken = null }

    // ── Keystore ───────────────────────────────────────────────────────────

    private fun keyStore() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private fun newKey(): SecretKey {
        runCatching { keyStore().deleteEntry(KEY_ALIAS) }
        val spec = KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true)
            .apply {
                if (Build.VERSION.SDK_INT >= 30) setUserAuthenticationParameters(AUTH_SECONDS, KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL)
                else @Suppress("DEPRECATION") setUserAuthenticationValidityDurationSeconds(AUTH_SECONDS)
            }
            .build()
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply { init(spec) }.generateKey()
    }

    private fun key(): SecretKey? = (keyStore().getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.secretKey

    /** Right after a successful prompt: lock the full token behind a fresh key */
    fun storeFull(ctx: Context, token: String) {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, newKey())
        val data = cipher.doFinal(token.toByteArray(Charsets.UTF_8))
        prefs(ctx).edit().putString("locked", "${b64(cipher.iv)}:${b64(data)}").commit()
        fullToken = token
    }

    /**
     * Right after a successful prompt: the full token. Throws KeyPermanentlyInvalidatedException when a fingerprint was
     * added since (then the account password is needed once), UserNotAuthenticatedException when the prompt was too long ago.
     */
    fun unlock(ctx: Context): String {
        val stored = prefs(ctx).getString("locked", null) ?: throw IllegalStateException("No locked token")
        val k = key() ?: throw KeyPermanentlyInvalidatedException("The lock key is gone")
        val (iv, data) = stored.split(":", limit = 2)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, k, GCMParameterSpec(128, unb64(iv)))
        val token = String(cipher.doFinal(unb64(data)), Charsets.UTF_8)
        fullToken = token
        return token
    }

    fun markEnabled(ctx: Context, on: Boolean) = prefs(ctx).edit().putBoolean("enabled", on).commit()

    /** Lock off / signed out: forget the key and the locked token */
    fun reset(ctx: Context) {
        runCatching { keyStore().deleteEntry(KEY_ALIAS) }
        prefs(ctx).edit().remove("locked").putBoolean("enabled", false).commit()
        fullToken = null
    }

    // ── Prompt ─────────────────────────────────────────────────────────────

    /** Fingerprint/face (strong) or the phone's PIN/pattern/password */
    fun authenticators() = if (Build.VERSION.SDK_INT >= 30) BIOMETRIC_STRONG or DEVICE_CREDENTIAL else BIOMETRIC_WEAK or DEVICE_CREDENTIAL

    /** "ok" | "none-enrolled" | "no-hardware" */
    fun availability(ctx: Context): String = when (BiometricManager.from(ctx).canAuthenticate(authenticators())) {
        BiometricManager.BIOMETRIC_SUCCESS -> "ok"
        BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> "none-enrolled"
        else -> "no-hardware"
    }

    fun prompt(activity: FragmentActivity, title: String, subtitle: String?, onOk: () -> Unit, onFail: (String?) -> Unit) {
        prompting = true
        val prompt = BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) { prompting = false; onOk() }
            override fun onAuthenticationError(code: Int, msg: CharSequence) {
                prompting = false
                val cancelled = code == BiometricPrompt.ERROR_USER_CANCELED || code == BiometricPrompt.ERROR_CANCELED || code == BiometricPrompt.ERROR_NEGATIVE_BUTTON
                onFail(if (cancelled) null else msg.toString())
            }
        })
        prompt.authenticate(
            BiometricPrompt.PromptInfo.Builder()
                .setTitle(title)
                .apply { if (subtitle != null) setSubtitle(subtitle) }
                .setAllowedAuthenticators(authenticators())
                .setConfirmationRequired(false)
                .build(),
        )
    }

    private fun b64(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.NO_WRAP)
    private fun unb64(s: String) = Base64.decode(s, Base64.NO_WRAP)
}
