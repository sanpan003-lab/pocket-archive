package com.sanpan003.pocketarchive.offline

import android.content.Context
import android.net.Uri
import android.webkit.MimeTypeMap
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import androidx.webkit.WebViewFeature
import com.getcapacitor.Bridge
import com.getcapacitor.BridgeWebViewClient
import com.sanpan003.pocketarchive.quick.TokenStore
import java.io.ByteArrayInputStream

/**
 * The app shell (2.9.0). The screens load from the NAS as before; on top of that:
 *  - a page load while the NAS can't be reached (airplane mode, no signal, NAS down) gets the screens bundled in
 *    the app at once — same address, so the same sign-in, settings and offline copy (no 30 s wait, no error page);
 *  - files of the bundled screens (/assets/…, icons) come from the app;
 *  - photos, scans, files and audio kept in the offline copy are served from it (with Range, so audio can seek) —
 *    also online, which saves data; when offline and not kept, they fail at once instead of waiting.
 * Everything else goes to Capacitor as before.
 */
class ShellClient(private val bridge: Bridge, private val ctx: Context) : BridgeWebViewClient(bridge) {
    private val nasHost: String? = runCatching { Uri.parse(bridge.serverUrl ?: "").host }.getOrNull()
    private val documentStart = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)

    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
        val url = request.url
        if (nasHost != null && url.host.equals(nasHost, ignoreCase = true) && request.method == "GET") {
            val path = url.path ?: "/"
            if (path.startsWith("/api/")) {
                OfflineStore.mediaResponse(ctx, path, url.getQueryParameter("v"), request.requestHeaders)?.let { return it }
                if (NasProbe.reachable == false && OfflineStore.isMediaPath(path)) return notThere()
            } else {
                Bundled.file(ctx, path)?.let { return it }
                // The app's pages: bundled screens when the NAS can't be reached (Capacitor's bridge script is added
                // to every page of this address by the WebView itself — DOCUMENT_START_SCRIPT)
                if (request.isForMainFrame && documentStart && !NasProbe.check(TokenStore.apiBase(ctx), maxAgeMs = 10_000)) {
                    Bundled.index(ctx)?.let { return it }
                }
            }
        }
        return super.shouldInterceptRequest(view, request)
    }

    private fun notThere() = WebResourceResponse("text/plain", "utf-8", 404, "Not offline", mapOf("Cache-Control" to "no-store"),
        ByteArrayInputStream("Not in the offline copy".toByteArray()))
}

/** The screens bundled in the APK (assets/public — the same build as the NAS's, made by npm run build:android) */
object Bundled {
    @Volatile private var files: Set<String>? = null

    private fun list(ctx: Context): Set<String> {
        files?.let { return it }
        val out = HashSet<String>()
        fun walk(dir: String) {
            val names = ctx.assets.list(dir) ?: return
            if (names.isEmpty()) { out += dir.removePrefix("public"); return }
            for (n in names) walk("$dir/$n")
        }
        walk("public")
        files = out
        return out
    }

    /** /assets/…, /icons/…, /favicon.svg… — never the pages themselves */
    fun file(ctx: Context, path: String): WebResourceResponse? {
        if (path == "/" || path.endsWith(".html") || path !in list(ctx)) return null
        val ext = MimeTypeMap.getFileExtensionFromUrl(path)
        val mime = when (ext) { "js", "mjs" -> "text/javascript"; "css" -> "text/css"; "json", "webmanifest" -> "application/json"; "svg" -> "image/svg+xml"
            else -> MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream" }
        return runCatching {
            WebResourceResponse(mime, null, 200, "OK", mapOf("Cache-Control" to "public, max-age=31536000, immutable"), ctx.assets.open("public$path"))
        }.getOrNull()
    }

    fun index(ctx: Context): WebResourceResponse? = runCatching {
        WebResourceResponse("text/html", "utf-8", 200, "OK", mapOf("Cache-Control" to "no-store"), ctx.assets.open("public/index.html"))
    }.getOrNull()

    /** The bundled screens' version (verify-release compares it with the NAS) */
    fun version(ctx: Context): String? = runCatching {
        org.json.JSONObject(ctx.assets.open("public/bundle-version.json").bufferedReader().readText()).optString("version")
    }.getOrNull()
}
