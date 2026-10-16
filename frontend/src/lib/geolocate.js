// "Use current location": the phone's GPS in the app (WebView geolocation), the browser's location on the web.
export const GEO_ERRORS = {
  1: 'Location permission is off — allow it for Pocket Archive.',
  2: "Couldn't get a location fix — try again outside or near a window.",
  3: 'Getting your location took too long — try again.',
};

/** → { lat, lng, accuracy } */
export function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error(window.isSecureContext ? "This browser can't share its location." : 'Location needs a secure (https) connection.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      err => reject(new Error(GEO_ERRORS[err.code] || 'Could not get your location.')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  });
}
