import { Capacitor } from '@capacitor/core';

// True inside the Android app (Capacitor); false in any browser
export const isNative = Capacitor.isNativePlatform();

// Web build: VITE_API_BASE_URL is unset, so the API stays same-origin "/api".
// Android app: its screens load from the NAS (Capacitor server.url), so the
// page's own origin is the server; a bundled Android build (.env.android) sets
// VITE_API_BASE_URL instead. Native code needs the absolute URL either way.
const configured = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
export const API_ORIGIN = configured || (isNative ? window.location.origin : '');
export const API_BASE = `${API_ORIGIN}/api`;
