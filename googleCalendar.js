// Google Calendar sync via a service account.
// Needs GOOGLE_SERVICE_ACCOUNT_FILE (JSON key path) and GOOGLE_CALENDAR_ID
// (the calendar shared with the service account). If either is missing,
// every call is skipped and the caller keeps the in-app copy only.

const fs = require('fs');

const TIMEZONE = 'America/New_York';
const SCOPES   = ['https://www.googleapis.com/auth/calendar'];

let calendarPromise = null;
let warned = false;

function missingConfig() {
  const keyFile    = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
  const calendarId = process.env.GOOGLE_CALENDAR_ID;
  if (!keyFile || !calendarId) return 'GOOGLE_SERVICE_ACCOUNT_FILE / GOOGLE_CALENDAR_ID not set';
  if (!fs.existsSync(keyFile)) return `service account key not found at ${keyFile}`;
  return null;
}

function isConfigured() {
  const problem = missingConfig();
  if (problem && !warned) {
    console.warn(`[google-calendar] Sync disabled — ${problem}`);
    warned = true;
  }
  return !problem;
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
async function createEvent(event) {
  const calendar = await getCalendar();
  const res = await calendar.events.insert({
    calendarId:  process.env.GOOGLE_CALENDAR_ID,
    requestBody: event,
  });
  return res.data.id;
}

async function updateEvent(eventId, event) {
  const calendar = await getCalendar();
  await calendar.events.update({
    calendarId:  process.env.GOOGLE_CALENDAR_ID,
    eventId,
    requestBody: event,
  });
  return eventId;
}

// Already-deleted events (404/410) count as success
async function deleteEvent(eventId) {
  const calendar = await getCalendar();
  try {
    await calendar.events.delete({ calendarId: process.env.GOOGLE_CALENDAR_ID, eventId });
  } catch (err) {
    const status = err.code || err.response?.status;
    if (status !== 404 && status !== 410) throw err;
  }
}

module.exports = { TIMEZONE, isConfigured, createEvent, updateEvent, deleteEvent };
