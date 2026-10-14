# Google Calendar setup for Quick Capture

Quick Capture can put voice-captured events and reminders straight onto your
Google Calendar. It uses a **service account**: a robot Google account that
you give permission to edit one calendar. No sign-in pop-ups, and nothing
expires.

This is optional. Without it, events and reminders are still saved in Pocket
Archive and shown on its Calendar page. The server logs
`[google-calendar] Sync disabled` once and carries on.

Takes about 10 minutes.

## 1. Create a Google Cloud project

1. Go to <https://console.cloud.google.com/> and sign in with the Google
   account that owns your calendar.
2. Click the project picker at the top → **New Project**.
3. Name it `Pocket Archive` → **Create**, then make sure it's selected.

## 2. Enable the Google Calendar API

1. Open **APIs & Services → Library**
   (<https://console.cloud.google.com/apis/library>).
2. Search for **Google Calendar API** → open it → **Enable**.

## 3. Create the service account

1. Open **IAM & Admin → Service Accounts**
   (<https://console.cloud.google.com/iam-admin/serviceaccounts>).
2. **Create service account**.
   - Name: `pocket-archive-calendar`
   - Click **Create and continue**, skip the optional role and user steps → **Done**.
3. Copy the service account's email. It looks like
   `pocket-archive-calendar@your-project.iam.gserviceaccount.com`.
   You'll need it in step 5.

## 4. Download the JSON key

1. Click the service account → **Keys** tab → **Add key → Create new key**.
2. Choose **JSON** → **Create**. A `.json` file downloads.
3. Rename it to `google-service-account.json`.
4. Copy it to the NAS config folder that the container mounts as
   `/data/config`:

   ```
   /volume1/pocket-archive-app/config/google-service-account.json
   ```

> **Keep this file secret.** Anyone with it can edit your calendar. Never put
> it in the Git repo. `*service-account*.json` is already in `.gitignore` and
> `.dockerignore`. If it ever leaks, delete the key on the **Keys** tab and
> create a new one.

## 5. Share your calendar with the service account

1. Open Google Calendar on a computer: <https://calendar.google.com/>.
2. In the left sidebar, hover your calendar (usually your name) → **⋮ →
   Settings and sharing**.
3. Under **Share with specific people or groups** → **Add people and groups**.
4. Paste the service account email from step 3.
5. Set permission to **Make changes to events** → **Send**.

While you're on that page, scroll to **Integrate calendar** and note the
**Calendar ID**. For your main calendar it's your Gmail address.

## 6. Configure Pocket Archive

Add these to the container's environment. On the NAS, put them in the
`environment:` list of `docker-compose.yml`:

```yaml
      - GOOGLE_SERVICE_ACCOUNT_FILE=/data/config/google-service-account.json
      - GOOGLE_CALENDAR_ID=you@gmail.com
```

For local development, put the same two lines (without the leading `- `) in
the backend `.env`, with `GOOGLE_SERVICE_ACCOUNT_FILE` pointing at the key on
your PC.

Then rebuild and restart:

```
cd /volume1/docker/pocket-archive
docker-compose up -d --build
```

## 7. Test it

1. Open Pocket Archive → **Quick Capture**.
2. Tap the mic and say: *"Test appointment tomorrow at 10 AM."*
3. You should hear *"Added to calendar: …"* and the event should appear in
   Google Calendar within a few seconds.
4. Tap **Undo**. The event disappears from Google Calendar.

In the Quick Capture **Inbox**, each capture shows what happened, for example
"Synced to Google Calendar".

## Troubleshooting

| Inbox / log says | Fix |
|---|---|
| `Google Calendar not configured` | One of the two variables is missing, or the key file isn't at that path inside the container. |
| `Google Calendar sync failed: Not Found` | The calendar isn't shared with the service account (step 5), or `GOOGLE_CALENDAR_ID` is wrong. |
| `… insufficient permission` / `403` | Sharing permission must be **Make changes to events**, not "See all event details". |
| `… Calendar API has not been used in project …` | Enable the Google Calendar API (step 2) and wait a minute. |

Events are created in the `America/New_York` time zone. Reminders appear as
`⏰ <title>`: all-day if you didn't say a time, otherwise 30 minutes long.
