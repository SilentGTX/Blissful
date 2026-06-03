// Minimal Chrome DevTools Protocol client for driving the on-device Blissful
// WebView over adb. Node 22 global WebSocket.
//
// Usage:
//   node cdp.mjs <wsUrl> "<jsExpression>" [listenMs]
//   node cdp.mjs <wsUrl> --key <Enter|ArrowDown|...> [listenMs]   (simulate a key)
//
// Captures console.*, Log entries, and exceptions for `listenMs` after the
// action (default 0 = exit immediately after eval).
const WS_URL = process.argv[2];
const MODE = process.argv[3];
const ARG = process.argv[4];
const LISTEN_MS = parseInt(process.argv[5] || (MODE === '--key' ? '1500' : '0'), 10);

const ws = new WebSocket(WS_URL);
let id = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((res) => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

function fmtArg(a) {
  if (a == null) return String(a);
  if (a.value !== undefined) return typeof a.value === 'object' ? JSON.stringify(a.value) : String(a.value);
  if (a.preview) return JSON.stringify(a.preview.properties?.map((p) => `${p.name}:${p.value}`) || a.description);
  return a.description || a.type;
}

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method === 'Runtime.consoleAPICalled') {
    const args = (msg.params.args || []).map(fmtArg).join(' ');
    console.log(`[CONSOLE.${msg.params.type}] ${args}`);
  } else if (msg.method === 'Log.entryAdded') {
    console.log(`[LOG.${msg.params.entry.level}] ${msg.params.entry.text}`);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    console.log(`[EXCEPTION] ${d.text} ${d.exception?.description || ''}`.slice(0, 600));
  } else if (msg.method === 'Network.responseReceived') {
    const r = msg.params.response;
    if (r.status >= 400) console.log(`[NET ${r.status}] ${r.url}`.slice(0, 300));
  } else if (msg.method === 'Network.loadingFailed') {
    console.log(`[NET FAIL] ${msg.params.errorText} ${msg.params.type} (req ${msg.params.requestId})`);
  }
});

async function dispatchKey(key) {
  // Map a few common keys to their codes for a faithful keydown+keyup.
  const MAP = {
    Enter: { keyCode: 13, code: 'Enter' },
    ArrowDown: { keyCode: 40, code: 'ArrowDown' },
    ArrowUp: { keyCode: 38, code: 'ArrowUp' },
    ArrowLeft: { keyCode: 37, code: 'ArrowLeft' },
    ArrowRight: { keyCode: 39, code: 'ArrowRight' },
    ' ': { keyCode: 32, code: 'Space' },
  };
  const m = MAP[key] || { keyCode: 0, code: key };
  for (const type of ['rawKeyDown', 'keyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', {
      type: type === 'keyDown' ? 'keyDown' : type === 'keyUp' ? 'keyUp' : 'rawKeyDown',
      key,
      code: m.code,
      windowsVirtualKeyCode: m.keyCode,
      nativeVirtualKeyCode: m.keyCode,
    });
  }
}

ws.addEventListener('open', async () => {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  // Drop the retained console buffer so we only see NEW messages from our action.
  // (Log domain intentionally NOT enabled — it replays a stale resource-error
  // buffer that can't be cleared in time and drowns the live signal.)
  await send('Runtime.discardConsoleEntries');
  if (MODE === '--key') {
    console.log(`>>> dispatching key: ${ARG}`);
    await dispatchKey(ARG);
  } else if (MODE) {
    // CDP nests the eval result at msg.result.result.value.
    const r = await send('Runtime.evaluate', {
      expression: MODE,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    const inner = r.result || {};
    if (inner.exceptionDetails) {
      console.log('[EVAL ERROR]', inner.exceptionDetails.text, inner.exceptionDetails.exception?.description || JSON.stringify(inner.exceptionDetails.exception?.value));
    } else {
      const v = inner.result?.value;
      console.log('[EVAL]', typeof v === 'object' ? JSON.stringify(v, null, 2) : v);
    }
  }
  if (LISTEN_MS > 0) {
    setTimeout(() => process.exit(0), LISTEN_MS);
  } else {
    process.exit(0);
  }
});
ws.addEventListener('error', (e) => {
  console.error('WS ERROR', e.message || e);
  process.exit(1);
});
