// True when running as the installed home-screen app (Android/desktop
// standalone display mode, or iOS "Add to Home Screen")
export function isInstalledApp() {
  try {
    return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
  } catch {
    return false;
  }
}
