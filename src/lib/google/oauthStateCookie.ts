// Plain constant, deliberately NOT in actions/googleConnection.ts: a "use
// server" file may only export async functions (plus type-only exports) -
// a runtime const export there breaks the whole module's action boundary.
export const OAUTH_STATE_COOKIE = "google_oauth_state";
