package com.sanpan003.pocketarchive.quick

/**
 * One quick command (timer / alarm / reminder) must run exactly once per recording, whoever is first:
 * the on-device fast path ("local") or the server's classification coming back ("server").
 * The loser skips running it (the server's note/action entry still exists as the record).
 */
class CommandClaims(private val store: Store) {
    interface Store {
        fun get(key: String): String?
        fun put(key: String, value: String)
    }

    /** true = this caller is first and should run the command */
    @Synchronized
    fun claim(clientId: String, by: String): Boolean {
        if (clientId.isBlank()) return true // no id to match on: never block a command
        if (!store.get(clientId).isNullOrEmpty()) return false
        store.put(clientId, by)
        return true
    }

    @Synchronized
    fun claimedBy(clientId: String): String? = store.get(clientId)?.takeIf { it.isNotEmpty() }

    /** A failed local attempt hands the command back (the server's copy may still run it) */
    @Synchronized
    fun release(clientId: String, by: String) {
        if (store.get(clientId) == by) store.put(clientId, "")
    }
}
