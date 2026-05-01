import axios from 'axios';

const http = axios.create({ baseURL: '/api', withCredentials: true });

// Auth
export const authStatus     = () => http.get('/auth/status').then(r => r.data);
export const authLogin      = password => http.post('/auth/login', { password }).then(r => r.data);
export const authLogout     = () => http.post('/auth/logout').then(r => r.data);
export const changePassword = (currentPassword, newPassword) =>
  http.post('/auth/change-password', { currentPassword, newPassword }).then(r => r.data);

export const getRecordings      = ()        => http.get('/recordings').then(r => r.data);
export const getRecording       = id        => http.get(`/recordings/${id}`).then(r => r.data);
export const searchRecordings   = q         => http.get('/search', { params: { q } }).then(r => r.data);
export const getStats           = ()        => http.get('/stats').then(r => r.data);
export const getHealth          = ()        => http.get('/health').then(r => r.data);
export const triggerSync        = ()        => http.post('/sync').then(r => r.data);
export const getSyncStatus      = ()        => http.get('/sync/status').then(r => r.data);
export const audioUrl           = fn        => `/api/audio/${fn}`;

// Regenerate AI Notes via Claude
export const regenerateAiNotes  = id        => http.post(`/recordings/${id}/regenerate`).then(r => r.data);
export const saveAiNotes        = (id, content) => http.put(`/recordings/${id}/ai-notes`, { content }).then(r => r.data);

// Attachments
export const getAttachments     = id        => http.get(`/recordings/${id}/attachments`).then(r => r.data);
export const deleteAttachment   = (id, fn)  => http.delete(`/recordings/${id}/attachments/${fn}`).then(r => r.data);
export const attachmentUrl      = (id, fn)  => `/api/recordings/${id}/attachments/${fn}`;
export const uploadAttachment   = (id, file, onProgress) => {
  const form = new FormData();
  form.append('file', file);
  return http.post(`/recordings/${id}/attachments`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: e => onProgress?.(Math.round((e.loaded * 100) / e.total)),
  }).then(r => r.data);
};
