import { Capacitor } from '@capacitor/core';

// True inside the Android app (Capacitor); false in any browser
export const isNative = Capacitor.isNativePlatform();

// The Android build sets VITE_API_BASE_URL (.env.android) because the app's
// pages are bundled locally. The web build leaves it unset and keeps using
// the same-origin "/api".
export const API_ORIGIN = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
export const API_BASE = `${API_ORIGIN}/api`;
