/**
 * auth.js — Google OAuth 2.0 via Google Identity Services (GIS)
 * Uses token-based flow (no server required, GitHub Pages compatible)
 */

// ⚠️ Replace with your real OAuth Client ID from Google Cloud Console
export const CLIENT_ID = '588867230099-c87i2qa4hlqlq9j7ddqgehgfuskdof9k.apps.googleusercontent.com';

const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';

let tokenClient    = null;
let accessToken    = null;
let tokenExpiresAt = 0;
let pendingCallback = null;

/**
 * Initialize the GIS token client.
 * Retries every 200ms until the GIS library script has loaded.
 */
export function initAuth() {
  return new Promise((resolve) => {
    const tryInit = () => {
      if (typeof google !== 'undefined' &&
          google.accounts &&
          google.accounts.oauth2) {
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID,
          scope:     SCOPES,
          callback:  _handleTokenResponse,
        });
        resolve(true);
      } else {
        setTimeout(tryInit, 200);
      }
    };
    tryInit();
  });
}

/** Internal: called by GIS after token granted or error */
function _handleTokenResponse(response) {
  if (response.error) {
    console.error('[Auth] Token error:', response.error);
    accessToken    = null;
    tokenExpiresAt = 0;
    if (pendingCallback) {
      const cb    = pendingCallback;
      pendingCallback = null;
      cb(false, response.error);
    }
    return;
  }

  accessToken    = response.access_token;
  const expiresIn = (response.expires_in || 3600) * 1000;
  tokenExpiresAt  = Date.now() + expiresIn;

  if (pendingCallback) {
    const cb    = pendingCallback;
    pendingCallback = null;
    cb(true, null);
  }
}

/**
 * Sign in — opens the OAuth popup.
 * callback(success: boolean, error: string|null)
 */
export function signIn(callback) {
  // Guard: CLIENT_ID not configured yet
  if (CLIENT_ID === 'YOUR_CLIENT_ID_HERE') {
    callback(false, 'client_id_not_set');
    return;
  }

  // GIS not ready yet — init then retry
  if (!tokenClient) {
    initAuth().then(() => signIn(callback));
    return;
  }

  // Already have a valid token — skip popup
  if (isSignedIn() && !isTokenExpired()) {
    callback(true, null);
    return;
  }

  pendingCallback = callback;
  try {
    tokenClient.requestAccessToken({ prompt: 'select_account' });
  } catch (err) {
    console.error('[Auth] requestAccessToken error:', err);
    const cb    = pendingCallback;
    pendingCallback = null;
    if (cb) cb(false, String(err));
  }
}

/**
 * Silent token refresh — no popup shown.
 * Returns a Promise<boolean> resolving to success/failure.
 */
export function refreshToken() {
  return new Promise((resolve) => {
    if (!tokenClient) { resolve(false); return; }
    pendingCallback = (success) => resolve(success);
    try {
      tokenClient.requestAccessToken({ prompt: '' });
    } catch (err) {
      console.error('[Auth] silent refresh error:', err);
      const cb    = pendingCallback;
      pendingCallback = null;
      if (cb) cb(false);
    }
  });
}

/**
 * Sign out — clears in-memory token only.
 * localStorage is NOT touched (keeps spreadsheet IDs and backups).
 */
export function signOut() {
  if (accessToken && typeof google !== 'undefined') {
    try { google.accounts.oauth2.revoke(accessToken, () => {}); }
    catch (e) { /* ignore */ }
  }
  accessToken     = null;
  tokenExpiresAt  = 0;
  pendingCallback = null;
}

export function isSignedIn()     { return accessToken !== null; }
export function getToken()       { return accessToken; }
export function isTokenExpired() { return Date.now() > tokenExpiresAt - 60_000; }

/**
 * Ensures a valid non-expired token exists before any API call.
 * Silently refreshes if expired. Returns Promise<boolean>.
 */
export async function ensureValidToken() {
  if (isSignedIn() && !isTokenExpired()) return true;
  if (!isSignedIn()) return false;
  return refreshToken();
}
