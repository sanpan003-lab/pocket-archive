package com.sanpan003.pocketarchive.quick

import android.app.AlertDialog
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.UserNotAuthenticatedException
import android.text.InputType
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.fragment.app.FragmentActivity
import com.sanpan003.pocketarchive.R
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** The server side of the app lock: the capture-only token, and a new full token after the fingerprints changed */
object AppLockServer {
    private val client by lazy { OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).build() }
    private val JSON = "application/json".toMediaType()

    private fun call(ctx: android.content.Context, method: String, path: String, token: String, body: JSONObject? = null): JSONObject {
        val api = TokenStore.apiBase(ctx) ?: throw IllegalStateException("Sign in first")
        val req = Request.Builder().url("$api$path").header("Authorization", "Bearer $token")
            .method(method, body?.toString()?.toRequestBody(JSON) ?: if (method == "GET") null else ByteArray(0).toRequestBody(JSON)).build()
        try {
            client.newCall(req).execute().use { r ->
                val text = r.body.string()
                if (!r.isSuccessful) throw IllegalStateException(Uploader.errorMessage(text) ?: "The server answered ${r.code}")
                return runCatching { JSONObject(text) }.getOrDefault(JSONObject())
            }
        } catch (e: java.io.IOException) {
            throw IllegalStateException("No connection to your server — try again on Wi-Fi")
        }
    }

    /** Full token → a capture-only token for this phone */
    fun captureToken(ctx: android.content.Context, full: String): String =
        call(ctx, "POST", "/api/auth/device-token/capture", full).optString("token").takeIf { it.isNotBlank() } ?: throw IllegalStateException("No token came back")

    fun revokeCapture(ctx: android.content.Context, full: String) = runCatching { call(ctx, "DELETE", "/api/auth/device-token/capture", full) }

    /** Fingerprints changed: the account password → a new full token for this same device */
    fun renew(ctx: android.content.Context, password: String): String {
        val capture = TokenStore.captureToken(ctx) ?: throw IllegalStateException("Sign in again")
        return call(ctx, "POST", "/api/auth/device-token/renew", capture, JSONObject().put("password", password))
            .optString("token").takeIf { it.isNotBlank() } ?: throw IllegalStateException("No token came back")
    }
}

/**
 * The lock screen over the app (a native view above the WebView): Unlock (fingerprint / PIN), and Stop while a
 * recording that started from a key or the widget is running. The app's content stays covered until unlocked.
 */
object LockScreen {
    private const val TAG = "LockScreen"
    // Weak references: the overlay belongs to one activity (a recreated activity gets its own)
    private var overlayRef = java.lang.ref.WeakReference<View>(null)
    private var ownerRef = java.lang.ref.WeakReference<FragmentActivity>(null)
    private var statusRef = java.lang.ref.WeakReference<TextView>(null)
    private var stopRef = java.lang.ref.WeakReference<Button>(null)
    private val overlay get() = overlayRef.get()
    private val status get() = statusRef.get()
    private val stopButton get() = stopRef.get()

    fun isShown() = overlay != null

    /** Recents / screenshots: hidden while the lock is on (Settings → "Hide content…", default on) */
    fun applySecure(activity: FragmentActivity) {
        val on = AppLock.enabled(activity) && AppLock.secure(activity)
        if (on) activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE) else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }

    fun show(activity: FragmentActivity, autoPrompt: Boolean) {
        if (overlay == null || ownerRef.get() !== activity) {
            overlay?.let { (it.parent as? ViewGroup)?.removeView(it) }
            val v = build(activity)
            activity.addContentView(v, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            overlayRef = java.lang.ref.WeakReference(v)
            ownerRef = java.lang.ref.WeakReference(activity)
        }
        refresh()
        if (autoPrompt && !AppLock.prompting) unlock(activity)
    }

    fun refresh() {
        stopButton?.visibility = if (RecorderState.recording) View.VISIBLE else View.GONE
    }

    fun hide() {
        overlay?.let { (it.parent as? ViewGroup)?.removeView(it) }
        overlayRef = java.lang.ref.WeakReference(null)
        statusRef = java.lang.ref.WeakReference(null)
        stopRef = java.lang.ref.WeakReference(null)
    }

    fun unlock(activity: FragmentActivity) {
        status?.text = ""
        AppLock.prompt(activity, "Unlock Pocket Archive", null, onOk = {
            try {
                val token = AppLock.unlock(activity)
                unlocked(activity, token)
            } catch (e: KeyPermanentlyInvalidatedException) {
                passwordOnce(activity)
            } catch (e: UserNotAuthenticatedException) {
                status?.text = "Try again"
            } catch (e: Exception) {
                Log.w(TAG, "Unlock failed", e)
                if (e.cause is KeyPermanentlyInvalidatedException) passwordOnce(activity) else status?.text = "Couldn’t unlock — try again"
            }
        }, onFail = { msg -> status?.text = msg ?: "" })
    }

    private fun unlocked(activity: FragmentActivity, token: String) {
        hide()
        QuickRecorderPlugin.onUnlocked(activity, token)
    }

    /** A fingerprint was added since: the account password once, then the fingerprint again for the new key */
    private fun passwordOnce(activity: FragmentActivity) {
        val input = EditText(activity).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            hint = "Password"
        }
        val box = FrameLayout(activity).apply { setPadding(dp(activity, 20), dp(activity, 8), dp(activity, 20), 0); addView(input) }
        AlertDialog.Builder(activity)
            .setTitle("Your fingerprints changed")
            .setMessage("For your security, enter your Pocket Archive password once.")
            .setView(box)
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Continue") { _, _ ->
                val pw = input.text.toString()
                status?.text = "Checking…"
                Thread {
                    try {
                        val token = AppLockServer.renew(activity, pw)
                        activity.runOnUiThread {
                            AppLock.prompt(activity, "Confirm with your fingerprint", "Sets up the lock for your new fingerprint", onOk = {
                                try { AppLock.storeFull(activity, token); unlocked(activity, token) }
                                catch (e: Exception) { Log.w(TAG, "Re-key failed", e); status?.text = "Couldn’t set up the lock — try again" }
                            }, onFail = { msg -> status?.text = msg ?: "Confirm with your fingerprint to finish" })
                        }
                    } catch (e: Exception) {
                        activity.runOnUiThread { status?.text = e.message ?: "That didn’t work" }
                    }
                }.start()
            }
            .show()
    }

    private fun dp(ctx: android.content.Context, v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), ctx.resources.displayMetrics).toInt()

    private fun build(activity: FragmentActivity): View {
        val root = FrameLayout(activity).apply {
            setBackgroundColor(Color.parseColor("#0B0B10"))
            isClickable = true      // nothing underneath can be touched
            isFocusable = true
            contentDescription = "Pocket Archive is locked"
        }
        val col = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(activity, 32), 0, dp(activity, 32), 0)
        }
        col.addView(ImageView(activity).apply { setImageResource(R.mipmap.ic_launcher) }, LinearLayout.LayoutParams(dp(activity, 72), dp(activity, 72)))
        col.addView(TextView(activity).apply {
            text = "Pocket Archive is locked"
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
            setPadding(0, dp(activity, 16), 0, dp(activity, 4))
            gravity = Gravity.CENTER
        })
        col.addView(TextView(activity).apply {
            text = "Recording, scanning and the widget still work."
            setTextColor(Color.parseColor("#B3FFFFFF"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            gravity = Gravity.CENTER
        })
        fun pill(label: String, gold: Boolean) = Button(activity).apply {
            text = label
            isAllCaps = false
            setTextColor(if (gold) Color.parseColor("#1A1300") else Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            background = GradientDrawable().apply {
                cornerRadius = dp(activity, 24).toFloat()
                setColor(Color.parseColor(if (gold) "#F59E0B" else "#26FFFFFF"))
            }
            setPadding(dp(activity, 28), dp(activity, 12), dp(activity, 28), dp(activity, 12))
        }
        val lp = { top: Int -> LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(activity, top) } }
        col.addView(pill("Unlock", true).apply { setOnClickListener { unlock(activity) } }, lp(28))
        val stop = pill("Stop recording", false).apply { setOnClickListener { QuickActions.stop(activity); visibility = View.GONE } }
        stopRef = java.lang.ref.WeakReference(stop)
        col.addView(stop, lp(12))
        val statusView = TextView(activity).apply {
            setTextColor(Color.parseColor("#FCD34D"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            gravity = Gravity.CENTER
            setPadding(0, dp(activity, 16), 0, 0)
        }
        statusRef = java.lang.ref.WeakReference(statusView)
        col.addView(statusView)
        root.addView(col, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER))
        return root
    }
}
