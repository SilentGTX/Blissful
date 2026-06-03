// Trakt API app credentials. Kept in a SEPARATE file so the rest of the
// integration (traktApi.ts, the scrobble hook, the Settings panel) compiles
// and ships INERT until you paste real values here.
//
// HOW TO FILL THESE IN:
//   1. Sign in at https://trakt.tv
//   2. Go to Settings -> "Your API Apps" -> "New Application"
//      (direct link: https://trakt.tv/oauth/applications)
//   3. Give it a name. For the redirect URI use the device-flow OOB value:
//        urn:ietf:wg:oauth:2.0:oob
//      (Blissful uses the TV-friendly device-code flow, not a browser
//       redirect, so no real callback URL is needed.)
//   4. Copy the "Client ID" and "Client Secret" the app page shows you and
//      paste them between the quotes below.
//
// Until BOTH are non-empty, isTraktConfigured() returns false and every
// function in traktApi.ts no-ops / returns null — nothing throws, nothing
// hits the network, no UI cost. So this whole feature is safe to merge now
// and "switch on" later just by editing this one file.

export const TRAKT_CLIENT_ID = '';
export const TRAKT_CLIENT_SECRET = '';

/**
 * True only when BOTH credentials have been filled in above. All Trakt code
 * paths are gated on this — when false they are guaranteed inert.
 */
export function isTraktConfigured(): boolean {
  return Boolean(TRAKT_CLIENT_ID && TRAKT_CLIENT_SECRET);
}
