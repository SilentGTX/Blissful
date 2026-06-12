// Repo-root `npm run dev`. With no arguments it opens the Blissful Dev
// Launcher (an Electron GUI living in scripts/dev-launcher/ with its own
// node_modules — the root package.json stays a dep-free thin proxy and
// installs the launcher's deps on first run). With an app argument it
// bypasses the GUI and runs that environment directly in the terminal,
// which is also the fallback when Electron fails to install or start.
//
// Usage: npm run dev                  -> GUI launcher (start/stop each app)
//        npm run dev desktop          -> run that app headless (also: web,
//                                        android, or any prefix like w/d/a)
//        npm run dev -- --cli         -> force the old interactive CLI menu
//        node scripts/dev.cjs --print [app]  -> resolve only, don't spawn
//                                       (used by tests / sanity checks)

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const LAUNCHER_DIR = path.join(__dirname, 'dev-launcher');

const APPS = [
  {
    name: 'web',
    summary: 'Vite dev server only — open :5173 in a browser',
    command: 'npm run --prefix apps/web-blissful dev:vite',
    cwd: ROOT,
  },
  {
    name: 'desktop',
    aliases: ['shell'],
    summary: 'Vite + the Rust shell (WebView2 + mpv), concurrently',
    command: 'npm run --prefix apps/web-blissful dev',
    cwd: ROOT,
  },
  {
    name: 'android',
    aliases: ['tv'],
    summary: 'Android TV Metro (expo start --port 8081)',
    command: 'npm start -- --port 8081',
    cwd: path.join(ROOT, 'apps', 'android-blissful'),
  },
];

function matchApp(input) {
  const q = input.trim().toLowerCase();
  if (!q) return null;
  const n = Number(q);
  if (Number.isInteger(n) && n >= 1 && n <= APPS.length) return APPS[n - 1];
  return (
    APPS.find((a) => [a.name, ...(a.aliases ?? [])].some((alias) => alias.startsWith(q))) ?? null
  );
}

function printMenu() {
  console.log('\nBlissful dev — which app?\n');
  for (const [i, app] of APPS.entries()) {
    console.log(`  ${i + 1}) ${app.name.padEnd(8)} ${app.summary}`);
  }
  console.log('');
}

function ask() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const prompt = () => {
      rl.question(`Select 1-${APPS.length} (or web/desktop/android): `, (answer) => {
        const app = matchApp(answer);
        if (app) {
          resolve(app); // before close() — its 'close' handler resolves null
          rl.close();
        } else {
          prompt();
        }
      });
    };
    prompt();
    rl.on('close', () => resolve(null)); // EOF (ctrl+c / piped stdin ran out)
  });
}

function run(app, printOnly) {
  console.log(`\n> ${app.command}  (cwd: ${path.relative(ROOT, app.cwd) || '.'})\n`);
  if (printOnly) return;
  const child = spawn(app.command, { cwd: app.cwd, shell: true, stdio: 'inherit' });
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 1);
  });
}

// The electron package's entry point exports the path to electron.exe —
// which only exists if its postinstall binary download completed.
function resolveElectron() {
  try {
    const exe = require(path.join(LAUNCHER_DIR, 'node_modules', 'electron'));
    return typeof exe === 'string' && fs.existsSync(exe) ? exe : null;
  } catch {
    return null;
  }
}

// GUI path: make sure the launcher's deps AND the Electron binary exist
// (first run installs; an interrupted binary download self-heals via
// `npm rebuild electron`, since plain `npm install` skips postinstall for
// already-extracted packages), then hand over. Returns false on any
// failure so main() can fall back to the CLI menu.
function launchGui() {
  let electronExe = resolveElectron();
  if (!electronExe) {
    const pkgExtracted = fs.existsSync(path.join(LAUNCHER_DIR, 'node_modules', 'electron'));
    const cmd = pkgExtracted ? 'npm rebuild electron' : 'npm install --no-audit --no-fund';
    console.log(
      pkgExtracted
        ? 'Dev Launcher install looks incomplete (Electron binary missing) — repairing…\n'
        : 'First run: installing the Dev Launcher dependencies into scripts/dev-launcher/ (one-off)…\n',
    );
    const result = spawnSync(cmd, { cwd: LAUNCHER_DIR, shell: true, stdio: 'inherit' });
    if (result.status !== 0) {
      console.error(`\n${cmd} failed in scripts/dev-launcher.`);
      return false;
    }
    electronExe = resolveElectron();
  }
  if (!electronExe) return false;

  const child = spawn(electronExe, [LAUNCHER_DIR], { stdio: 'inherit' });
  let fellBack = false;
  child.on('error', (err) => {
    // Binary exists but won't run (AV block, corrupted download, deleted
    // between the existsSync check and the spawn) — honor the documented
    // contract and drop to the CLI menu instead of dying.
    fellBack = true;
    console.error(`Electron failed to start: ${err.message} — falling back to the CLI menu.`);
    void cliMenu(false);
  });
  child.on('exit', (code) => {
    if (!fellBack) process.exit(code ?? 0);
  });
  return true;
}

async function cliMenu(printOnly) {
  printMenu();
  const app = await ask();
  if (!app) process.exit(1);
  run(app, printOnly);
}

async function main() {
  const args = process.argv.slice(2);
  const printOnly = args.includes('--print');
  const forceCli = args.includes('--cli');
  const positional = args.filter((a) => a !== '--print' && a !== '--cli');

  if (positional.length > 0) {
    const app = matchApp(positional[0]);
    if (!app) {
      console.error(
        `Unknown app "${positional[0]}". Expected one of: ${APPS.map((a) => a.name).join(', ')}.`,
      );
      process.exit(1);
    }
    run(app, printOnly);
    return;
  }

  if (forceCli || printOnly) {
    await cliMenu(printOnly);
    return;
  }

  if (!launchGui()) {
    console.error('Could not start the GUI launcher — falling back to the CLI menu.');
    await cliMenu(false);
  }
}

main();
