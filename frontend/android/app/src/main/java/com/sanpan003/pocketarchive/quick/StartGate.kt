package com.sanpan003.pocketarchive.quick

/**
 * The one rule for starting a recording from outside the app (2.13.2): only a real press may start one.
 * Pure decision function (unit-tested); the activities that receive launches collect the facts and call it.
 *
 * Why: the "Quick Record" launcher entry used to be an alias of MainActivity, so it could become the root of the
 * app's task. Whenever Android re-created or re-launched that task (Recents, task restore, a process restart),
 * the original launcher intent was delivered again and the app started recording with nobody touching the phone.
 * The log on the phone shows exactly that: starts on a lit lock screen, at 3 AM, reported as launched by the app itself.
 */
object StartGate {
    enum class Verdict { ALLOW, CONFIRM, BLOCK }

    data class Input(
        /** package that launched this (Activity.referrer host); null / blank when unknown */
        val referrer: String?,
        val ownPackage: String,
        /** FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY: Recents / task restore */
        val fromHistory: Boolean,
        /** the activity is being re-created from saved state (rotation, process death, task restore) */
        val recreated: Boolean,
        /** an old task whose root is the Quick Record launcher alias reached MainActivity */
        val staleAlias: Boolean,
        /** off | locked | on  (locked = screen lit behind the keyguard) */
        val screen: String,
        val justWoken: Boolean,
        /** our own tap (widget, tile, in-app button) — never an external launch */
        val explicitInApp: Boolean = false,
    )

    data class Decision(val verdict: Verdict, val reason: String)

    fun decide(i: Input): Decision {
        if (i.recreated) return Decision(Verdict.BLOCK, "The screen was restored or re-created (no new press)")
        if (i.fromHistory) return Decision(Verdict.BLOCK, "Opened from Recents / a restored task (no new press)")
        if (i.staleAlias) return Decision(Verdict.BLOCK, "An old task re-launched the Quick Record entry (no new press)")
        if (i.explicitInApp) return Decision(Verdict.ALLOW, "Tap inside the app")
        val ref = i.referrer.orEmpty()
        // Launched "on behalf of this app" (a launcher shortcut, or a restored task): a person can open a shortcut
        // only on an unlocked screen, so on a locked or dark screen it is never a press
        if (ref == i.ownPackage) {
            return if (i.screen == "on") Decision(Verdict.ALLOW, "App shortcut on an unlocked screen")
            else Decision(Verdict.BLOCK, "Launched on behalf of the app while the phone was ${if (i.screen == "off") "asleep" else "locked"} (not a press)")
        }
        // A side key / Routine / S Pen / Edge panel / watch relay: they wake the screen with the press. A screen that has
        // been lit behind the keyguard for a while, or an unknown sender, must be confirmed (3 s, volume up or tap)
        if (ref.isBlank()) return Decision(Verdict.CONFIRM, "Unknown sender: press again to confirm")
        if (i.screen == "locked" && !i.justWoken) return Decision(Verdict.CONFIRM, "The lock screen was already lit: press again to confirm")
        return Decision(Verdict.ALLOW, "Launched by $ref")
    }
}
