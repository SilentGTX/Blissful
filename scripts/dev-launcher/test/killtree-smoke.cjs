// Validates the tree-kill primitive against a synthetic process chain that
// mirrors the real one (cmd -> node -> grandchild node holding a port):
// killTree on the top pid must take the grandchild's listener down with it.
// Safe to run any time — uses a scratch port, never touches the dev envs.
// Run: node scripts/dev-launcher/test/killtree-smoke.cjs

'use strict';

const { spawn } = require('child_process');
const { probePort, killTree } = require('../lib/manager.cjs');

const PORT = 56123;
const log = (msg) => console.log(`[killtree] ${msg}`);

function waitFor(label, fn, timeoutMs, intervalMs = 300) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = async () => {
      if (await fn()) return resolve();
      if (Date.now() > deadline) return reject(new Error(`timed out waiting for: ${label}`));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

async function main() {
  if (await probePort(PORT)) throw new Error(`scratch port ${PORT} unexpectedly in use`);

  // Parent node process spawns a detached-ish child that listens; the shell
  // wrapper (shell: true) adds the same cmd.exe layer npm runs under.
  const parentScript = `
    const { spawn } = require('child_process');
    const c = spawn(process.execPath, ['-e', 'require(String.fromCharCode(110,101,116)).createServer().listen(${PORT}, () => {}); setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    setInterval(() => {}, 1000);
  `;
  const top = spawn(`node -e "${parentScript.replace(/\n/g, ' ').replace(/"/g, '\\"')}"`, {
    shell: true,
    windowsHide: true,
    stdio: 'ignore',
  });
  log(`spawned chain (top pid ${top.pid}), waiting for grandchild to bind :${PORT}…`);

  await waitFor('grandchild listening', () => probePort(PORT), 15000);
  log('grandchild is listening');

  await killTree(top.pid);
  await waitFor('port freed', async () => !(await probePort(PORT)), 10000);
  log(`tree killed, :${PORT} freed`);
  console.log('[killtree] PASS');
  process.exit(0);
}

main().catch((err) => {
  console.error(`[killtree] FAIL: ${err.message}`);
  process.exit(1);
});
