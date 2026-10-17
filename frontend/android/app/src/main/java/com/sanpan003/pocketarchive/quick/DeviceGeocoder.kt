package com.sanpan003.pocketarchive.quick

import android.content.Context
import android.location.Address
import android.location.Geocoder
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Android's built-in Geocoder: the fallback when OpenStreetMap (on the server) can't find an
 * address. Free, no API key. Background thread only (it blocks for up to ~10 s).
 * Not every phone has a geocoder backend (Geocoder.isPresent()); then it returns nothing.
 */
object DeviceGeocoder {
    private const val TIMEOUT_S = 10L

    fun available() = Geocoder.isPresent()

    /** Address / place name → up to [max] matches, near [near] first when given (≈ 50 km box, then anywhere). */
    fun search(ctx: Context, query: String, near: Pair<Double, Double>?, max: Int = 5): JSONArray {
        if (!available() || query.isBlank()) return JSONArray()
        val geocoder = Geocoder(ctx, Locale.US)
        var found = emptyList<Address>()
        if (near != null) {
            val d = 0.45 // ≈ 50 km
            found = lookup { cb -> fromName(geocoder, query, max, near.first - d, near.second - d, near.first + d, near.second + d, cb) }
        }
        if (found.isEmpty()) found = lookup { cb -> fromName(geocoder, query, max, null, null, null, null, cb) }
        return JSONArray().apply { found.filter { it.hasLatitude() && it.hasLongitude() }.forEach { put(toJson(it, query)) } }
    }

    /** Coordinates → nearest street address (or null). */
    fun reverse(ctx: Context, lat: Double, lng: Double): String? {
        if (!available()) return null
        val geocoder = Geocoder(ctx, Locale.US)
        val found = lookup { cb ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                geocoder.getFromLocation(lat, lng, 1, object : Geocoder.GeocodeListener {
                    override fun onGeocode(addresses: MutableList<Address>) = cb(addresses)
                    override fun onError(errorMessage: String?) = cb(emptyList())
                })
            } else {
                @Suppress("DEPRECATION")
                cb(runCatching { geocoder.getFromLocation(lat, lng, 1) }.getOrNull().orEmpty())
            }
        }
        return found.firstOrNull()?.let(::addressLine)
    }

    private fun fromName(g: Geocoder, q: String, max: Int, lla: Double?, llo: Double?, ula: Double?, ulo: Double?, cb: (List<Address>) -> Unit) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val listener = object : Geocoder.GeocodeListener {
                override fun onGeocode(addresses: MutableList<Address>) = cb(addresses)
                override fun onError(errorMessage: String?) = cb(emptyList())
            }
            if (lla != null) g.getFromLocationName(q, max, lla, llo!!, ula!!, ulo!!, listener)
            else g.getFromLocationName(q, max, listener)
        } else {
            @Suppress("DEPRECATION")
            cb(runCatching { if (lla != null) g.getFromLocationName(q, max, lla, llo!!, ula!!, ulo!!) else g.getFromLocationName(q, max) }.getOrNull().orEmpty())
        }
    }

    /** Runs a callback-style lookup and waits for it (with a timeout). */
    private fun lookup(start: ((List<Address>) -> Unit) -> Unit): List<Address> {
        val latch = CountDownLatch(1)
        var out: List<Address> = emptyList()
        runCatching { start { out = it; latch.countDown() } }.onFailure { latch.countDown() }
        latch.await(TIMEOUT_S, TimeUnit.SECONDS)
        return out
    }

    private fun addressLine(a: Address): String =
        (0..a.maxAddressLineIndex).mapNotNull { a.getAddressLine(it) }.joinToString(", ")
            .removeSuffix(", USA").removeSuffix(", United States")
            .ifBlank { listOfNotNull(a.thoroughfare, a.locality, a.adminArea, a.postalCode).joinToString(", ") }

    private fun toJson(a: Address, query: String): JSONObject {
        val line = addressLine(a)
        // featureName is often just the house number; use it as a name only when it's a real name
        val feature = a.featureName?.takeIf { it.isNotBlank() && !it.matches(Regex("^[0-9\\-]+$")) }
        val name = feature ?: line.substringBefore(",").ifBlank { query }
        return JSONObject()
            .put("name", name)
            .put("address", line)
            .put("lat", a.latitude)
            .put("lng", a.longitude)
            .put("source", "device")
    }
}
