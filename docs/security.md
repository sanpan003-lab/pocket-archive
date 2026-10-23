# App lock and passkeys (2.7.0)

## Android: app lock (Settings → Security → "Lock app with fingerprint")

Per device, off by default. `AppLock.kt`, `AppLockFlows.kt`, `TokenStore.kt`.

- **Two tokens.** Turning it on asks the server for a second, **capture-only** token for this device
  (`POST /api/auth/device-token/capture`), then encrypts the full device token with a Keystore key that needs the
  fingerprint or the phone's PIN within the last 30 s (`setUserAuthenticationRequired`, `AUTH_BIOMETRIC_STRONG |
  AUTH_DEVICE_CREDENTIAL`) and is invalidated when a new fingerprint is added. The plain copy is deleted.
- **Unlocked** = the full token in memory only, after BiometricPrompt. It's dropped when the app has been in the
  background longer than the chosen time: every open / 1 / 5 (default) / 15 minutes.
- **Locked**: a native lock screen covers the app (Unlock; Stop while a recording runs). The web layer's
  `getToken` waits until unlocked. `FLAG_SECURE` hides the app in recents and screenshots (on by default with the lock).
- **What keeps working while locked** (they use the capture token): widget, tile, Quick Record / side key / Quick Tap,
  Stop Recording, volume keys, Scan / Camera, the watch relay and the watch's own uploads, OTA updates, phone-action
  results, location-reminder events, Undo / Yes from a notification. Their notifications, the widget line and the
  watch result say "🔒 Saved" only, and the widget shows no note titles.
- **Server allowlist** for capture tokens (`accounts.js` `CAPTURE_ROUTES`): POST /api/quick/capture and /document,
  GET /api/updates/{phone,watch}/{latest,apk}, POST …/report, POST /api/actions/:id/result, POST /api/quick/:id/
  {undo,decide,done}, PATCH /api/quick/:id/items, POST /api/location-reminders/events, POST /api/errands/:id/triggered,
  POST /api/auth/device-token/renew. Anything else → 403 `{ locked: true }`. Reading notes, recent items, errands,
  changes, search and media tokens is never allowed.
- **New fingerprint added** → the key is gone (KeyPermanentlyInvalidatedException) → "Your fingerprints changed —
  enter your password once" → `POST /api/auth/device-token/renew { password }` (capture token) gives the same device a
  new full token (the old one stops working) → fingerprint again → locked behind a new key.
- **Turning it off** asks for the fingerprint, stores the full token as before and revokes the capture token
  (`DELETE /api/auth/device-token/capture`). Signing the device out also ends its capture token.
- Settings → Security → devices list shows "App lock on". Security log: `app_lock_on`, `app_lock_off`,
  `device_reauth`, `device_reauth_failed`. Works for Lite accounts.

## Web: passkeys (`passkeys.js`)

- Settings → Security → **Add a passkey** (fingerprint, face, Windows Hello, a phone). WebAuthn, verified on the NAS
  with `@simplewebauthn/server` (a library — no outside service). Stored in `CONFIG_DIR/passkeys.json` with its RP ID
  (the domain from the browser's Origin, so it works behind the reverse proxy). Discoverable credentials: the sign-in
  page doesn't need the username.
- Sign-in page → **Sign in with a passkey** → a normal session; **no 2FA code** (a passkey is two factors already).
  The password keeps working.
- List (added, last used, synced), rename, remove. Security log: `passkey_added`, `passkey_removed`,
  `login` with `method: 'passkey'`, `passkey_login_failed`. Failed passkey sign-ins count toward the IP rate limit.
- Only https (or localhost). Not in the Android app's WebView — the app uses the app lock.

## Tests (scratchpad, fake archive)

`lock-e2e.cjs` (capture token allowlist, renew, revoke), `fftools/passkey-ui.cjs` (Chrome's WebAuthn virtual
authenticator: add, sign in without 2FA, rename, remove, refused after removal), `AppLockTest` (JVM: lock timing).
