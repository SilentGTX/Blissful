// Stremio's "Sign in with Facebook" handshake. Two-step:
//
//   1. prepareFacebookFlow() -- generate a random state token and the
//      Stremio URL to navigate to. The popup (or current window) is
//      then navigated to `${STREMIO_URL}/login-fb/<state>` so the user
//      sees strem.io in the URL bar and does FB login on Stremio's
//      actual page.
//
//   2. pollFacebookCredentials(state) -- poll
//      `${STREMIO_URL}/login-fb-get-acc/<state>` until Stremio writes
//      the resulting FB credentials to that state slot. The caller
//      then exchanges those creds for a Stremio authKey via
//      api.strem.io/api/login (browser-direct, never through Blissful).
//
// Splitting the flow lets us drive it from the Blissful Settings tab
// (which holds the JWT and panel state) while the popup window simply
// navigates to Stremio and goes away.

const STREMIO_URL = 'https://www.strem.io';
const MAX_POLL_TRIES = 90;
const POLL_INTERVAL_MS = 1500;

function randomState(bytes = 16): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export type FacebookCredentials = {
  email: string;
  fbLoginToken: string;
};

export type FacebookFlowInit = {
  state: string;
  /** URL to navigate (popup or current window) to Stremio's FB login. */
  stremioUrl: string;
};

export function prepareFacebookFlow(): FacebookFlowInit {
  const state = randomState(32);
  return { state, stremioUrl: `${STREMIO_URL}/login-fb/${state}` };
}

async function getCredentials(state: string): Promise<FacebookCredentials> {
  // Routed through the same-origin /stremio proxy (Vite dev + Traefik
  // prod both forward /stremio/* to www.strem.io) so we avoid CORS.
  const res = await fetch(`/stremio/login-fb-get-acc/${state}`);
  if (!res.ok) {
    throw new Error(`Facebook auth polling failed (${res.status})`);
  }
  const data = (await res.json()) as { user?: { email?: string; fbLoginToken?: string } };
  if (!data.user?.email || !data.user?.fbLoginToken) {
    throw new Error('No credentials yet');
  }
  return { email: data.user.email, fbLoginToken: data.user.fbLoginToken };
}

export async function pollFacebookCredentials(
  state: string,
  options?: { signal?: AbortSignal },
): Promise<FacebookCredentials> {
  for (let tries = 0; tries < MAX_POLL_TRIES; tries++) {
    if (options?.signal?.aborted) {
      throw new Error('Facebook sign-in cancelled');
    }
    try {
      return await getCredentials(state);
    } catch {
      // No credentials at this state slot yet -- keep polling.
    }
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error('Facebook sign-in timed out');
}

/** Legacy one-shot helper used by LoginModal. Opens the FB popup and
 *  polls until Stremio writes the credentials. Kept for backward
 *  compatibility; new code should use prepareFacebookFlow() +
 *  pollFacebookCredentials() separately. */
export async function loginWithFacebookPopup(): Promise<FacebookCredentials> {
  const { state, stremioUrl } = prepareFacebookFlow();
  window.open(stremioUrl, '_blank', 'noopener,noreferrer');
  return pollFacebookCredentials(state);
}
