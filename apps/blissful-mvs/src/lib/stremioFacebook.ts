const STREMIO_URL = 'https://www.strem.io';
const MAX_TRIES = 90;

function randomState(bytes: number = 16) {
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

async function getCredentials(state: string): Promise<FacebookCredentials> {
  // Use local proxy for CORS.
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

export async function loginWithFacebookPopup(): Promise<FacebookCredentials> {
  const state = randomState(32);

  // This is hosted by Stremio and handles the Facebook OAuth flow.
  // We open it in a new tab/window, then poll for the resulting temp credentials.
  window.open(`${STREMIO_URL}/login-fb/${state}`, '_blank', 'noopener,noreferrer');

  for (let tries = 0; tries < MAX_TRIES; tries++) {
    try {
      return await getCredentials(state);
    } catch {
      // ignore and retry
    }
    await new Promise((r) => setTimeout(r, 1500));
  }

  throw new Error('Failed to authenticate with Facebook (timeout)');
}
