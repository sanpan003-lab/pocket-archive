// Google Calendar sync via a service account (the same one for every user).
// Needs GOOGLE_SERVICE_ACCOUNT_FILE (JSON key path). Each user's events go to their own
// calendar id (Settings → Google Calendar; shared with the service account); the admin
// falls back to GOOGLE_CALENDAR_ID. Without a key file or a calendar id every call is
// skipped and the caller keeps the in-app copy only.

const fs = require('fs');

const TIMEZONE = 'America/New_York';
const SCOPES   = ['https://www.googleapis.com/auth/calendar'];

let calendarPromise = null;
const warned = new Set();

function missingConfig(calendarId) {
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
  if (!keyFile) return 'GOOGLE_SERVICE_ACCOUNT_FILE not set';
  if (!calendarId) return 'no calendar id';
  if (!fs.existsSync(keyFile)) return `service account key not found at ${keyFile}`;
  return null;
}

function isConfigured(calendarId = process.env.GOOGLE_CALENDAR_ID) {
  const problem = missingConfig(calendarId);
  if (problem && !warned.has(problem)) {
    console.warn(`[google-calendar] Sync disabled — ${problem}`);
    warned.add(problem);
  }
  return !problem;
}

/** The service account's email (users share their calendar with it) */
function serviceAccountEmail() {
  try { return JSON.parse(fs.readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_FILE, 'utf8')).client_email || null; } catch { return null; }
}

function getCalendar() {
  if (!calendarPromise) {
    calendarPromise = (async () => {
      const { google } = require('googleapis');
      const auth = new google.auth.GoogleAuth({
        keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_FILE,
        scopes:  SCOPES,
      });
      return google.calendar({ version: 'v3', auth });
    })().catch(err => { calendarPromise = null; throw err; });
  }
  return calendarPromise;
}

// event: { summary, description, location, start, end } where start/end are
// Google EventDateTime objects ({ date } or { dateTime, timeZone })
async function createEvent(event, calendarId = process.env.GOOGLE_CALENDAR_ID) {
  const calendar = await getCalendar();
  const res = await calendar.events.insert({ calendarId, requestBody: event });
  return res.data.id;
}

async function updateEvent(eventId, event, calendarId = process.env.GOOGLE_CALENDAR_ID) {
  const calendar = await getCalendar();
  await calendar.events.update({ calendarId, eventId, requestBody: event });
  return eventId;
}

// Already-deleted events (404/410) count as success
async function deleteEvent(eventId, calendarId = process.env.GOOGLE_CALENDAR_ID) {
  const calendar = await getCalendar();
  try {
    await calendar.events.delete({ calendarId, eventId });
  } catch (err) {
    const status = err.code || err.response?.status;
    if (status !== 404 && status !== 410) throw err;
  }
}

/** "Test" button: can the service account see this calendar? */
async function testCalendar(calendarId) {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_FILE) return { ok: false, error: 'The server has no Google service account configured' };
  try {
    const calendar = await getCalendar();
    const r = await calendar.calendars.get({ calendarId });
    return { ok: true, summary: r.data.summary || calendarId };
  } catch (err) {
    return { ok: false, error: err.response?.status === 404 ? 'Calendar not found — share it with the service account first' : err.message };
  }
}

module.exports = { TIMEZONE, isConfigured, createEvent, updateEvent, deleteEvent, serviceAccountEmail, testCalendar };
