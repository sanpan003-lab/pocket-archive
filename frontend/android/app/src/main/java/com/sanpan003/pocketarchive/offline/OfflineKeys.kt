package com.sanpan003.pocketarchive.offline

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.sanpan003.pocketarchive.quick.AppLock
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * The offline copy's key (a random 256-bit database key; the media key is inside the database).
 *
 *   App lock off: wrapped by an Android Keystore key (never leaves the secure hardware).
 *   App lock on:  wrapped by a key derived from the full device token — which itself is only available after the
 *                 fingerprint / PIN (AppLock). So the copy can't be opened while the app is locked, not even by the
 *                 background sync; captures keep working through the capture-only token as before.
 *   New fingerprint enrolled (the token is renewed with the password): the old wrap can't be opened any more → the
 *   copy is deleted and downloaded again.
 */
object OfflineKeys {
    private const val PREFS = "offline_keys"
    private const val ALIAS = "pocket_archive_offline_db"
    private const val GCM = "AES/GCM/NoPadding"

    @Volatile private var cached: ByteArray? = null

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private fun b64(b: ByteArray) = Base64.encodeToString(b, Base64.NO_WRAP)
    private fun unb64(s: String) = Base64.decode(s, Base64.NO_WRAP)

    private fun keystoreKey(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).build())
        }.generateKey()
    }

    private fun tokenKey(ctx: Context, token: String): SecretKey {
        val p = prefs(ctx)
        val salt = p.getString("salt", null)?.let { unb64(it) } ?: ByteArray(32).also { SecureRandom().nextBytes(it); p.edit().putString("salt", b64(it)).commit() }
        val d = MessageDigest.getInstance("SHA-256").apply { update("pocket-archive-offline-v1".toByteArray()); update(salt); update(token.toByteArray()) }.digest()
        return SecretKeySpec(d, "AES")
    }

    private fun seal(key: SecretKey, plain: ByteArray): String {
        val c = Cipher.getInstance(GCM)
        c.init(Cipher.ENCRYPT_MODE, key)
        return "${b64(c.iv)}:${b64(c.doFinal(plain))}"
    }

    private fun open(key: SecretKey, sealed: String): ByteArray? = runCatching {
        val (iv, data) = sealed.split(":", limit = 2)
        val c = Cipher.getInstance(GCM)
        c.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, unb64(iv)))
        c.doFinal(unb64(data))
    }.getOrNull()

    sealed class Result {
        class Key(val key: ByteArray, val fresh: Boolean) : Result()
        /** App lock on and the app is locked */
        object Locked : Result()
        /** The key exists but can't be opened any more (fingerprints changed / lock state lost): start over */
        object Lost : Result()
    }

    /** The database key (creating one on first use) — or why there isn't one right now */
    @Synchronized
    fun get(ctx: Context): Result {
        val lockOn = AppLock.enabled(ctx)
        val token = if (lockOn) AppLock.unlockedToken(ctx) else null
        if (lockOn && token == null) { cached = null; return Result.Locked }
        cached?.let { return Result.Key(it, false) }
        val p = prefs(ctx)
        val plainWrap = p.getString("plain", null)
        val lockWrap = p.getString("lock", null)
        val key: ByteArray? = when {
            lockOn && lockWrap != null -> open(tokenKey(ctx, token!!), lockWrap)
            lockOn && plainWrap != null -> open(keystoreKey(), plainWrap)?.also { k -> // the lock was switched on: move behind it
                p.edit().putString("lock", seal(tokenKey(ctx, token!!), k)).remove("plain").commit()
            }
            !lockOn && plainWrap != null -> open(keystoreKey(), plainWrap)
            else -> null
        }
        if (key != null) { cached = key; return Result.Key(key, false) }
        // There was a copy, but its key can't be opened with what we have now
        if (plainWrap != null || lockWrap != null) return Result.Lost
        val fresh = ByteArray(32).also { SecureRandom().nextBytes(it) }
        if (lockOn) p.edit().putString("lock", seal(tokenKey(ctx, token!!), fresh)).commit()
        else p.edit().putString("plain", seal(keystoreKey(), fresh)).commit()
        cached = fresh
        return Result.Key(fresh, true)
    }

    /** App lock switched on (the full token is at hand right after the fingerprint) */
    @Synchronized
    fun onLockOn(ctx: Context, token: String) {
        val key = cached ?: prefs(ctx).getString("plain", null)?.let { open(keystoreKey(), it) } ?: return
        prefs(ctx).edit().putString("lock", seal(tokenKey(ctx, token), key)).remove("plain").commit()
        cached = key
    }

    /** App lock switched off (after the fingerprint): back to the Keystore wrap */
    @Synchronized
    fun onLockOff(ctx: Context, token: String) {
        val key = cached ?: prefs(ctx).getString("lock", null)?.let { open(tokenKey(ctx, token), it) } ?: return
        prefs(ctx).edit().putString("plain", seal(keystoreKey(), key)).remove("lock").commit()
        cached = key
    }

    /** Locked again (timeout / sign out): forget the key in memory */
    fun forget() { cached?.fill(0); cached = null }

    /** Signed out / copy deleted: a new key next time */
    @Synchronized
    fun reset(ctx: Context) {
        forget()
        prefs(ctx).edit().clear().commit()
        runCatching { KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(ALIAS) }
    }
}
