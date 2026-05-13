// Cargo launcher used by `npm run dev:shell` (and any other npm script
// that needs cargo). Looks for cargo on PATH first, then falls back to
// rustup's default install location (`~/.cargo/bin/cargo[.exe]`). This
// lets `npm run dev` work in shells that didn't inherit the Windows
// user PATH (MINGW64, fresh PowerShell from a non-default profile,
// etc.) without forcing the user to set environment variables.
//
// Usage: node scripts/run-cargo.cjs <cargo-args...>
//   e.g. node scripts/run-cargo.cjs run --features spike0a

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function findCargo() {
  const which = process.platform === 'win32' ? 'where' : 'which';
  try {
    const out = execSync(`${which} cargo`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const hit = out.split(/\r?\n/).find((p) => p.trim().length > 0);
    if (hit) return hit.trim();
  } catch {
    // not on PATH — fall through
  }
  const fallback = path.join(
    os.homedir(),
    '.cargo',
    'bin',
    process.platform === 'win32' ? 'cargo.exe' : 'cargo',
  );
  if (fs.existsSync(fallback)) return fallback;
  return null;
}

const cargo = findCargo();
if (!cargo) {
  console.error(
    'cargo not found on PATH or at ~/.cargo/bin/. Install Rust via https://rustup.rs and re-run.',
  );
  process.exit(127);
}

const args = process.argv.slice(2);
const child = spawn(cargo, args, { stdio: 'inherit' });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
