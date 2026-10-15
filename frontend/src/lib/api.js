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
// installed: true for the home-screen app → 30-day session (browser: 7 days)
export const authLogin      = (password, installed = false) =>
  http.post('/auth/login', { password, installed }).then(r => r.data);
export const authLogout     = () => http.post('/auth/logout').then(r => r.data);

// Android app sign-in: password → 90-day device token
export const deviceLogin         = (password, deviceName) =>
  http.post('/auth/device-token', { password, deviceName }).then(r => r.data);
export const revokeCurrentDevice = () => http.delete('/auth/devices/current').then(r => r.data);
export const getDevices          = () => http.get('/auth/devices').then(r => r.data);
export const revokeDevice        = id => http.delete(`/auth/devices/${id}`).then(r => r.data);
export const fetchMediaToken     = () => http.get('/auth/media-token').then(r => r.data);
export const changePassword = (currentPassword, newPassword) =>
  http.post('/auth/change-password', { currentPassword, newPassword }).then(r => r.data);

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

// Errands: checklist + places
export const updateErrandItems  = (id, change) => http.patch(`/quick/${id}/items`, change).then(r => r.data);
export const setErrandDone      = (id, done = true) => http.post(`/quick/${id}/done`, { done }).then(r => r.data);
export const getActiveErrands   = () => http.get('/errands/active').then(r => r.data);
export const getPlaces          = () => http.get('/places').then(r => r.data);
export const setHomeLocation    = address => http.put('/places/home', { address }).then(r => r.data);
export const clearHomeLocation  = () => http.delete('/places/home').then(r => r.data);
export const searchPlaces       = q => http.get('/places/search', { params: { q } }).then(r => r.data);
export const addSavedPlace      = place => http.post('/places/saved', place).then(r => r.data);
export const updateSavedPlace   = (id, place) => http.put(`/places/saved/${id}`, place).then(r => r.data);
export const deleteSavedPlace   = id => http.delete(`/places/saved/${id}`).then(r => r.data);
export const updateErrandSettings = settings => http.put('/errands/settings', settings).then(r => r.data);

// Trash / delete
export const getDeletedRecordings   = ()   => http.get('/recordings/deleted').then(r => r.data);
export const deleteRecording        = id   => http.post(`/recordings/${id}/delete`).then(r => r.data);
export const restoreRecording       = id   => http.post(`/recordings/${id}/restore`).then(r => r.data);
export const permanentDeleteRecording = id => http.post(`/recordings/${id}/permanent-delete`).then(r => r.data);
