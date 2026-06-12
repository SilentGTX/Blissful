// Trakt API credentials. Mirrors apps/web-blissful/src/lib/traktConfig.ts.
//
// INERT by default: with empty client_id/secret, isTraktConfigured() is false
// and the Trakt panel shows a "paste your API keys" hint with NO connect
// button — nothing hits the network. Fill these in (from
// trakt.tv -> Settings -> Your API Apps) to enable the TV-friendly device-code
// OAuth flow.
export const TRAKT_CLIENT_ID = '';
export const TRAKT_CLIENT_SECRET = '';

export function isTraktConfigured(): boolean {
  return TRAKT_CLIENT_ID.length > 0 && TRAKT_CLIENT_SECRET.length > 0;
}
