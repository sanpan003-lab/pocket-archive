import { registerPlugin } from '@capacitor/core';

/**
 * Native Android plugin (android/.../quick/QuickRecorderPlugin.kt):
 * foreground-service recorder, Keystore-backed token storage, launch routes.
 * Only used when running inside the app (see lib/platform.js → isNative).
 */
export const QuickRecorder = registerPlugin('QuickRecorder');
