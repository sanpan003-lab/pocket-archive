package com.sanpan003.pocketarchive.wear

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
 * The phone's device token, shared over the Data Layer for the direct-upload
 * fallback. Encrypted with an AES-256 key in the watch's Android Keystore;
 * only ciphertext is stored. Revoking the phone in Settings → Devices makes
 * the server reject it here too (same token); a 401 clears it.
 */
object WatchTokenStore {
    private const val PREFS = "watch_secure"
    private const val KEY_ALIAS = "pocket_archive_watch_token"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"

    @Volatile private var cached: Pair<String, String>? = null
    @Volatile private var loaded = false

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }

    /** (token, apiBase) or null. */
    @Synchronized
    fun get(ctx: Context): Pair<String, String>? {
        if (loaded) return cached
        cached = runCatching {
            val stored = prefs(ctx).getString("token", null) ?: return@runCatching null
            val apiBase = prefs(ctx).getString("apiBase", null) ?: return@runCatching null
            val (iv, data) = stored.split(":", limit = 2)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
            String(cipher.doFinal(Base64.decode(data, Base64.NO_WRAP)), Charsets.UTF_8) to apiBase
        }.getOrNull()
        loaded = true
        return cached
    }

    @Synchronized
    fun set(ctx: Context, token: String?, apiBase: String?) {
        val editor = prefs(ctx).edit()
        if (token.isNullOrBlank() || apiBase.isNullOrBlank()) {
            editor.remove("token").remove("apiBase")
            cached = null
        } else {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.ENCRYPT_MODE, key())
            val enc = cipher.doFinal(token.toByteArray(Charsets.UTF_8))
            editor.putString("token", "${Base64.encodeToString(cipher.iv, Base64.NO_WRAP)}:${Base64.encodeToString(enc, Base64.NO_WRAP)}")
                .putString("apiBase", apiBase.trimEnd('/'))
            cached = token to apiBase.trimEnd('/')
        }
        editor.commit()
        loaded = true
    }
}
