package com.sanpan003.pocketarchive.wear

/**
 * Phone ⇄ watch Data Layer paths. Keep in sync with the phone app's
 * quick/WearBridge.kt (same names, same payloads).
 */
object Protocol {
    /** Capability the phone app advertises (res/values/wear.xml on the phone). */
    const val CAP_PHONE = "pocket_archive_phone"
    /** Capability this watch app advertises. */
    const val CAP_WATCH = "pocket_archive_watch"

    /** ChannelClient: watch → phone audio. Full path: /pa/capture/<clientId>/<capturedAtMillis>[/<userId>] */
    const val CHANNEL_CAPTURE = "/pa/capture"
    /** Message phone → watch: the capture arrived complete. Payload: clientId. */
    const val MSG_CAPTURE_ACK = "/pa/capture-ack"
    /** Message phone → watch: server confirmation. JSON {clientId, icon, text, tone, detail} */
    const val MSG_RESULT = "/pa/result"
    /** Message phone → watch: device token for the direct-upload fallback. JSON {token, apiBase} */
    const val MSG_TOKEN = "/pa/token"
    const val MSG_TOKEN_CLEAR = "/pa/token-clear"
    /** Message watch → phone: please send the token / refresh the state. */
    const val MSG_TOKEN_REQUEST = "/pa/token-request"
    const val MSG_SYNC_REQUEST = "/pa/sync-request"
    /** Message phone → watch: "You're at Publix" (the watch shows its own notification). */
    const val MSG_ARRIVAL = "/pa/arrival"
    /** Message watch → phone: smart append answer. JSON {captureId, choice: "undo"|"yes"|"new"} */
    const val MSG_DECIDE = "/pa/decide"

    /** DataItem phone → watch: the watch's "while recording" settings edited on the phone. String "json" */
    const val DATA_REC_SETTINGS = "/pa/rec-settings"
    /** DataItem watch → phone: the same settings edited on the watch. String "json" */
    const val DATA_REC_SETTINGS_WATCH = "/pa/rec-settings-watch"

    /** DataItem phone → watch: recent notes + open errands. Strings "recent", "errands"; long "updatedAt". */
    const val DATA_STATE = "/pa/state"
    /** DataItem watch → phone: /pa/toggle/<errandId>/<itemId> {done, at}. The phone deletes it once applied. */
    const val DATA_TOGGLE = "/pa/toggle"
    /** DataItem watch → phone: /pa/done/<errandId> {at} ("Done" on the watch's arrival notification). */
    const val DATA_DONE = "/pa/done"

    /** Client ids of watch captures start with this, so the phone knows where to send the result. */
    const val CLIENT_PREFIX = "watch-"

    /** Watch → phone: one recording start for the phone's log (trigger, result, what was heard) */
    const val MSG_REC_LOG = "/pa/rec-log"
}
