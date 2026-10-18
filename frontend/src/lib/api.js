import axios from 'axios';
import { API_BASE, isNative } from './platform';
import { getDeviceToken, getMediaToken } from '../native/nativeSession';

// Web: same-origin "/api" + session cookie (unchanged).
// Android app: server URL from .env.android + "Authorization: Bearer <device token>".
const http = axios.create({ baseURL: API_BASE, withCredentials: true });

if (isNative) {
  http.interceptors.request.use(config => {
    const token = getDeviceToken();
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  });
  // Token revoked or expired → back to sign-in
  http.interceptors.response.use(undefined, error => {
    const url = error.config?.url || '';
    if (error.response?.status === 401 && !url.startsWith('/auth/')) {
      window.dispatchEvent(new CustomEvent('pa:unauthorized'));
    }
    return Promise.reject(error);
  });
}

// Protected media (<audio>, attachment links) can't send headers — in the app,
// add the short-lived read-only media token
function withMediaToken(url) {
  const token = isNative ? getMediaToken() : null;
  return token ? `${url}?mt=${encodeURIComponent(token)}` : url;
}

// Auth
export const authStatus     = () => http.get('/auth/status').then(r => r.data);
// installed: true for the home-screen app → 30-day session (browser: 7 days).
// With 2FA on, the first call answers { twoFactorRequired: true }; repeat it with code.
export const authLogin      = (username, password, installed = false, code = undefined) =>
  http.post('/auth/login', { username, password, installed, code }).then(r => r.data);
export const authLogout     = () => http.post('/auth/logout').then(r => r.data);

// Android app sign-in: username + password (+ 2FA code) → 90-day device token
export const deviceLogin         = (username, password, deviceName, code = undefined) =>
  http.post('/auth/device-token', { username, password, deviceName, code }).then(r => r.data);
export const revokeCurrentDevice = () => http.delete('/auth/devices/current').then(r => r.data);
export const getDevices          = () => http.get('/auth/devices').then(r => r.data);
export const revokeDevice        = id => http.delete(`/auth/devices/${id}`).then(r => r.data);
export const fetchMediaToken     = () => http.get('/auth/media-token').then(r => r.data);
export const changePassword = (currentPassword, newPassword) =>
  http.post('/auth/change-password', { currentPassword, newPassword }).then(r => r.data);

// Account + security
export const getMe              = () => http.get('/auth/me').then(r => r.data);
export const updateMe           = patch => http.patch('/auth/me', patch).then(r => r.data);
export const setup2fa           = () => http.post('/auth/2fa/setup').then(r => r.data);
export const confirm2fa         = code => http.post('/auth/2fa/confirm', { code }).then(r => r.data);
export const disable2fa         = password => http.post('/auth/2fa/disable', { password }).then(r => r.data);
export const getSessions        = () => http.get('/auth/sessions').then(r => r.data);
export const revokeSession      = id => http.delete(`/auth/sessions/${id}`).then(r => r.data);
export const signOutEverywhere  = () => http.post('/auth/sign-out-everywhere').then(r => r.data);
export const getSecurityLog     = () => http.get('/auth/security-log').then(r => r.data);
export const getCalendarSetup   = () => http.get('/calendar/setup').then(r => r.data);
export const testCalendar       = calendarId => http.post('/calendar/test', { calendarId }).then(r => r.data);

// Admin: Settings → Users
export const adminUsers         = () => http.get('/admin/users').then(r => r.data);
export const adminCreateUser    = user => http.post('/admin/users', user).then(r => r.data);
export const adminUpdateUser    = (id, patch) => http.patch(`/admin/users/${id}`, patch).then(r => r.data);
export const adminResetPassword = (id, password) => http.post(`/admin/users/${id}/reset-password`, { password }).then(r => r.data);
export const adminReset2fa      = id => http.post(`/admin/users/${id}/reset-2fa`).then(r => r.data);
export const adminUnlock        = id => http.post(`/admin/users/${id}/unlock`).then(r => r.data);
export const adminExportUser    = id => http.post(`/admin/users/${id}/export`).then(r => r.data);
export const adminDeleteUser    = (id, confirm) => http.delete(`/admin/users/${id}`, { data: { confirm } }).then(r => r.data);
export const adminSecurityLog   = () => http.get('/admin/security-log').then(r => r.data);

export const getRecordings      = ()        => http.get('/recordings').then(r => r.data);
export const getRecording       = id        => http.get(`/recordings/${id}`).then(r => r.data);
export const searchRecordings   = q         => http.get('/search', { params: { q } }).then(r => r.data);
export const getStats           = ()        => http.get('/stats').then(r => r.data);
export const getHealth          = ()        => http.get('/health').then(r => r.data);
export const triggerSync        = ()        => http.post('/sync').then(r => r.data);
export const getSyncStatus      = ()        => http.get('/sync/status').then(r => r.data);
export const audioUrl           = fn        => `${API_BASE}/audio/${fn}`;

// Regenerate AI Notes — model: 'gemini' (default) | 'claude'
export const regenerateAiNotes  = (id, model = 'gemini') =>
  http.post(`/recordings/${id}/regenerate`, { model }).then(r => r.data);
export const saveAiNotes        = (id, content) => http.put(`/recordings/${id}/ai-notes`, { content }).then(r => r.data);

// Attachments
export const getAttachments     = id        => http.get(`/recordings/${id}/attachments`).then(r => r.data);
export const deleteAttachment   = (id, fn)  => http.delete(`/recordings/${id}/attachments/${fn}`).then(r => r.data);
export const attachmentUrl      = (id, fn)  => withMediaToken(`${API_BASE}/recordings/${id}/attachments/${fn}`);
export const uploadAttachment   = (id, file, onProgress) => {
  const form = new FormData();
  form.append('file', file);
  return http.post(`/recordings/${id}/attachments`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: e => onProgress?.(Math.round((e.loaded * 100) / e.total)),
  }).then(r => r.data);
};

// Editing
export const updateTitle        = (id, title)   => http.put(`/recordings/${id}/title`, { title }).then(r => r.data);
export const updateDate         = (id, date)    => http.put(`/recordings/${id}/date`, { date }).then(r => r.data);
export const updateOriginalNotes = (id, content) => http.put(`/recordings/${id}/original-notes`, { content }).then(r => r.data);
export const updatePocketSummary = (id, content) => http.put(`/recordings/${id}/pocket-summary`, { content }).then(r => r.data);

// Create
export const createRecording = (formData, onProgress) =>
  http.post('/recordings/create', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: e => onProgress?.(Math.round((e.loaded * 100) / e.total)),
  }).then(r => r.data);

// Quick Capture
export const getQuickNotes      = (params = {}) => http.get('/quick', { params }).then(r => r.data);
export const captureQuick       = formData => http.post('/quick/capture', formData, {
  headers: { 'Content-Type': 'multipart/form-data' },
  timeout: 120000,
}).then(r => r.data);
export const updateQuickNote    = (id, data) => http.put(`/quick/${id}`, data).then(r => r.data);
export const undoQuickNote      = id => http.post(`/quick/${id}/undo`).then(r => r.data);
export const retryQuickNote     = id => http.post(`/quick/${id}/retry`).then(r => r.data);
export const getQuickNote       = id => http.get(`/quick/${id}`).then(r => r.data);
export const summarizeQuickNote = id => http.post(`/quick/${id}/summarize`).then(r => r.data);
export const quickAudioUrl      = id => withMediaToken(`${API_BASE}/quick/${id}/audio`);
export const quickMediaUrl      = id => withMediaToken(`${API_BASE}/quick/${id}/media`);
export const restoreQuickNote   = id => http.post(`/quick/${id}/restore`).then(r => r.data);
export const setQuickMeta       = (id, meta) => http.patch(`/quick/${id}/meta`, meta).then(r => r.data);
export const searchQuickNotes   = q => http.get('/quick/search', { params: { q } }).then(r => r.data);
export const convertHandwriting = id => http.post(`/quick/${id}/handwriting`, null, { timeout: 90000 }).then(r => r.data);

// "+" create menu: typed note / checklist, photo / drawing (same AI pipeline as voice)
export const createTextNote     = data => http.post('/quick/text', data, { timeout: 120000 }).then(r => r.data);
export const createMediaNote    = (formData, onProgress) => http.post('/quick/media', formData, {
  headers: { 'Content-Type': 'multipart/form-data' },
  timeout: 180000,
  onUploadProgress: e => onProgress?.(e.total ? Math.round((e.loaded * 100) / e.total) : 0),
}).then(r => r.data);

// Appearance & layout (shared across devices)
// Self-hosted map (PMTiles): status + absolute URLs (the app adds its media token)
export const getMapStatus       = () => http.get('/maps/status').then(r => r.data);
export const mapUrl             = rel => {
  const base = new URL(API_BASE, window.location.origin).href.replace(/\/$/, '');
  return withMediaToken(`${base}/maps/${rel}`);
};

export const getAppearance      = () => http.get('/appearance').then(r => r.data);
export const saveAppearance     = groups => http.put('/appearance', groups).then(r => r.data);

// Smart append: answers, Move, Merge into, Combine, settings
export const decideQuickNote    = (id, choice, dest = {}) => http.post(`/quick/${id}/decide`, { choice, ...dest }).then(r => r.data);
export const moveQuickNote      = (id, dest) => http.post(`/quick/${id}/move`, dest).then(r => r.data);
export const mergeQuickNote     = (id, target) => http.post(`/quick/${id}/merge`, target).then(r => r.data);
export const unmergeQuickNote   = id => http.post(`/quick/${id}/unmerge`).then(r => r.data);
export const combineQuickNotes  = (mainId, ids, title) => http.post('/quick/combine', { mainId, ids, title }).then(r => r.data);
export const suggestCombinedTitle = ids => http.post('/quick/combine/suggest', { ids }).then(r => r.data);
export const splitQuickNote     = (id, groupId) => http.post(`/quick/${id}/split`, { groupId }).then(r => r.data);
export const searchQuickTargets = (q, exclude) => http.get('/quick/targets', { params: { q, exclude } }).then(r => r.data);
export const getQuickSettings   = () => http.get('/quick/settings').then(r => r.data);
export const updateQuickSettings = settings => http.put('/quick/settings', settings).then(r => r.data);

// Projects
export const getProjects        = (params = {}) => http.get('/projects', { params }).then(r => r.data);
export const getProject         = id => http.get(`/projects/${id}`).then(r => r.data);
export const createProject      = (name, aliases = []) => http.post('/projects', { name, aliases }).then(r => r.data);
export const updateProject      = (id, data) => http.put(`/projects/${id}`, data).then(r => r.data);
export const mergeProject       = (id, intoId) => http.post(`/projects/${id}/merge`, { intoId }).then(r => r.data);
export const addNotesToProject  = (id, noteIds) => http.post(`/projects/${id}/notes`, { noteIds }).then(r => r.data);
export const removeNoteFromProject = (id, noteId) => http.delete(`/projects/${id}/notes/${noteId}`).then(r => r.data);
export const resummarizeProject = id => http.post(`/projects/${id}/summarize`).then(r => r.data);
export const deleteProject      = id => http.delete(`/projects/${id}`).then(r => r.data);
export const restoreProject     = id => http.post(`/projects/${id}/restore`).then(r => r.data);

// Errands: checklist + places
export const updateErrandItems  = (id, change) => http.patch(`/quick/${id}/items`, change).then(r => r.data);
export const setErrandDone      = (id, done = true) => http.post(`/quick/${id}/done`, { done }).then(r => r.data);
export const getActiveErrands   = () => http.get('/errands/active').then(r => r.data);
export const getPlaces          = () => http.get('/places').then(r => r.data);
// address string → server geocodes it; { lat, lng, accuracyM, source, address } → "Use my current location"
export const setHomeLocation    = home => http.put('/places/home', typeof home === 'string' ? { address: home } : home).then(r => r.data);
export const reversePlace       = (lat, lng) => http.get('/places/reverse', { params: { lat, lng } }).then(r => r.data);
export const clearHomeLocation  = () => http.delete('/places/home').then(r => r.data);
export const searchPlaces       = q => http.get('/places/search', { params: { q } }).then(r => r.data);
export const addSavedPlace      = place => http.post('/places/saved', place).then(r => r.data);
export const updateSavedPlace   = (id, place) => http.put(`/places/saved/${id}`, place).then(r => r.data);
export const deleteSavedPlace   = id => http.delete(`/places/saved/${id}`).then(r => r.data);
export const updateErrandSettings = settings => http.put('/errands/settings', settings).then(r => r.data);
// Location reminders (any place: "when I get home", "when I leave work")
export const getLocationReminders = () => http.get('/location-reminders').then(r => r.data);
export const setGeoPlace          = (id, body) => http.post(`/quick/${id}/geo-place`, body).then(r => r.data);
export const setReminderDone      = (id, done = true) => http.post(`/quick/${id}/done`, { done }).then(r => r.data);
// Radius of home / a saved place: { radiusMode: auto|small|medium|large|xl|custom, radiusM? }
export const setPlaceRadius       = (id, body) => http.put(`/places/radius/${id}`, body).then(r => r.data);
// "Set Work to my current location": { lat, lng, address? }
export const setWorkLocation      = body => http.post('/places/work', body).then(r => r.data);
export const getGeofenceLog       = () => http.get('/location-reminders/events').then(r => r.data);

// Trash / delete
export const getDeletedRecordings   = ()   => http.get('/recordings/deleted').then(r => r.data);
export const deleteRecording        = id   => http.post(`/recordings/${id}/delete`).then(r => r.data);
export const restoreRecording       = id   => http.post(`/recordings/${id}/restore`).then(r => r.data);
export const permanentDeleteRecording = id => http.post(`/recordings/${id}/permanent-delete`).then(r => r.data);
