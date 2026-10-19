import { isNative } from './platform';
import { QuickRecorder } from '../native/quickRecorder';

// Phone actions run in the Android app (native PhoneActions.kt): alarms and timers in the Clock app,
// directions in Google Maps, messages/calls prefilled (never sent or dialed), Do Not Disturb, flashlight,
// opening an app. The browser can only show them ("Open on phone").

export const ACTION_FILTERS = [
  { key: '', label: 'All' },
  { key: 'alarms', label: 'Alarms' },
  { key: 'timers', label: 'Timers' },
  { key: 'messages', label: 'Messages & calls' },
  { key: 'navigation', label: 'Navigation' },
  { key: 'other', label: 'Other' },
];

export const canRunActions = isNative;

/** pendingAction from a capture response ({ id, kind, … }) → run it now; → { status, icon, text, detail, undo } */
export async function runPhoneAction(action, choice = null) {
  if (!isNative || !action) return null;
  try { return await QuickRecorder.runPhoneAction({ action, choice }); } catch (err) { return { status: 'failed', icon: '⚠️', text: err.message || 'Couldn’t run it' }; }
}

/** Undo what can be undone: alarm/timer → Clock's list (you remove it there), flashlight off, DND restored */
export async function undoPhoneAction(action) {
  if (!isNative) return null;
  return QuickRecorder.undoPhoneAction({ action });
}

/** Several contacts / apps match: the choices (asks for contacts permission the first time) */
export async function findChoices(action) {
  if (!isNative) return { choices: [] };
  if (action.kind === 'openApp') return QuickRecorder.findApps({ name: action.appName });
  return QuickRecorder.findContacts({ name: action.to });
}

/** Typed capture in the app (+ menu): run its action and turn the toast into the result */
export async function confirmWithAction(result) {
  const action = result?.phoneAction;
  if (!action || !isNative) return result?.confirmation || null;
  const out = await runPhoneAction(action);
  if (!out) return result.confirmation;
  return { icon: out.icon || '⚡', text: out.text, detail: out.detail || (action.noteId ? `Note saved: ${result.note?.title}` : null), tone: out.status === 'failed' ? 'review' : 'success', undo: out.undo ? action : null };
}
