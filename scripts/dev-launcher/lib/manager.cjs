// Process + port state machine for the Blissful Dev Launcher. Pure Node —
// no Electron imports — so it can be exercised headless by test/*.cjs.
//
// Status truth is the port actually listening, not "process spawned":
// a poll loop net-probes each environment's port(s) and derives the phase
// from (managed child alive?) x (port up?). A port that is up with no
// managed child shows as "external" (e.g. vite started by hand) — which
// doubles as a visible signal if a stop ever orphans a listener.

'use strict';

const { EventEmitter } = require('events');
const { spawn, execFile, execFileSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { StringDecoder } = require('string_decoder');

const ROOT = path.resolve(__dirname, '..', '..', '..');

// adb helpers shared with the android dev script (safe to require: its
// main() is gated behind require.main). Lazy so a broken SDK setup can
// never take the whole manager down.
function androidTools() {
  try {
    const tools = require(path.join(ROOT, 'scripts', 'dev-android.cjs'));
    return fs.existsSync(tools.ADB) ? tools : null;
  } catch {
    return null;
  }
}

// Stop teardown for the android env: kill the app, then shut down any
// emulator. Real devices (TV over adb-wifi) only get the app force-stop —
// never a device kill. Runs after the script tree is taskkilled.
async function androidStopCleanup(logLine) {
  const tools = androidTools();
  if (!tools) return;
  const { adb, listDevices, PACKAGE } = tools;
  const devices = await listDevices();
  for (const d of devices) {
    if (d.state !== 'device') continue;
    await adb(['-s', d.serial, 'shell', 'am', 'force-stop', PACKAGE]);
    logLine(`> force-stopped ${PACKAGE} on ${d.serial}`);
  }
  // emu kill talks to the console port, so it also reaches still-booting
  // emulators that adb reports as offline.
  const emulators = devices.filter((d) => d.serial.startsWith('emulator-'));
  for (const d of emulators) {
    await adb(['-s', d.serial, 'emu', 'kill']);
    logLine(`> emulator ${d.serial}: shutdown requested`);
  }
  if (emulators.length === 0) return;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const still = (await listDevices()).filter((d) => d.serial.startsWith('emulator-'));
    if (still.length === 0) {
      logLine('> emulator is down');
      return;
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  logLine('> warning: emulator still listed after shutdown request');
}

// Quit-path twin of androidStopCleanup: synchronous, no waiting — fires
// the emu kill and moves on so before-quit cannot stall.
function androidStopCleanupSync() {
  const tools = androidTools();
  if (!tools) return;
  try {
    const out = execFileSync(tools.ADB, ['devices'], { encoding: 'utf8', windowsHide: true });
    for (const line of out.split(/\r?\n/).slice(1)) {
      const [serial] = line.trim().split(/\s+/);
      if (serial && serial.startsWith('emulator-')) {
        execFileSync(tools.ADB, ['-s', serial, 'emu', 'kill'], {
          stdio: 'ignore',
          windowsHide: true,
        });
      }
    }
  } catch {
    // adb unavailable — nothing to clean
  }
}

const LOG_BUFFER_MAX = 200;
const POLL_INTERVAL_MS = 1500;
const PROBE_TIMEOUT_MS = 750;
const DEP_WAIT_TIMEOUT_MS = 120000;

const ENVS = [
  {
    id: 'web',
    title: 'Web',
    tagline: 'Vite dev server for the React UI',
    command: 'npm run --prefix apps/web-blissful dev:vite',
    cwd: ROOT,
    ports: [5173],
    portLabel: ':5173',
    url: 'http://localhost:5173',
    accent: 'teal',
  },
  {
    id: 'desktop',
    title: 'Desktop',
    tagline: 'Rust shell — WebView2 + libmpv',
    command: 'npm run --prefix apps/web-blissful dev:shell',
    cwd: ROOT,
    // The shell's local proxy binds 5175 and walks upward if taken.
    ports: [5175, 5176, 5177, 5178],
    portLabel: ':5175+',
    url: null,
    accent: 'teal',
    // dev:shell wipes the shell's bundled-dist fallback and the shell only
    // probes :5173 for ~2s at boot — vite must be accepting connections
    // BEFORE cargo run starts or the window comes up black.
    needs: 'web',
  },
  {
    id: 'android',
    title: 'Android TV',
    tagline: 'TV emulator + Metro + app launch',
    // Boots the Television_1080p AVD if no device is online, starts Metro,
    // sets adb reverse, and launches the app. Stop kills the script tree
    // (Metro) and then runs the cleanup hook: app force-stopped, emulator
    // shut down via adb emu kill (real TVs only get the force-stop).
    command: 'node scripts/dev-android.cjs',
    cwd: ROOT,
    ports: [8081],
    portLabel: ':8081',
    url: 'http://localhost:8081',
    accent: 'lavender',
    stopCleanup: androidStopCleanup,
    stopCleanupSync: androidStopCleanupSync,
  },
];

// strip-ansi pattern: CSI/OSC escape sequences from vite/expo/cargo output.
// Built via fromCharCode so no raw control bytes live in this source file.
const ESC = String.fromCharCode(27);
const CSI = String.fromCharCode(155);
const BEL = String.fromCharCode(7);
const ANSI_RE = new RegExp(
  '[' + ESC + CSI + '][[\\]()#;?]*(?:(?:(?:[a-zA-Z\\d]*(?:;[-a-zA-Z\\d/#&.:=?%@~_]*)*)?' + BEL + ')|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))',
  'g',
);

function probePort(port, timeoutMs = PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: '127.0.0.1' });
    let settled = false;
    const done = (up) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(up);
    };
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
    sock.setTimeout(timeoutMs, () => done(false));
  });
}

function killTree(pid) {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => resolve());
    } else {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already gone
      }
      resolve();
    }
  });
}

function killTreeSync(pid) {
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // already gone
    }
  } else {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
}

class DevManager extends EventEmitter {
  constructor() {
    super();
    this.rt = new Map();
    for (const env of ENVS) {
      this.rt.set(env.id, {
        child: null,
        pid: null,
        phase: 'stopped', // stopped | waiting | starting | running | external | stopping | crashed
        detail: null,
        exitCode: null,
        userStopped: false,
        cancelWait: false,
        waiting: false,
        startPending: false,
        livePort: null,
        logs: [],
        lineBuffers: { out: '', err: '' },
      });
    }
    this.pollTimer = null;
    this.polling = false;
    this.lastSnapshotJson = '';
  }

  startPolling() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => void this.pollOnce(), POLL_INTERVAL_MS);
    void this.pollOnce();
  }

  dispose() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  env(id) {
    const env = ENVS.find((e) => e.id === id);
    if (!env) throw new Error(`unknown environment "${id}"`);
    return env;
  }

  snapshot() {
    return ENVS.map((env) => {
      const rt = this.rt.get(env.id);
      return {
        id: env.id,
        title: env.title,
        tagline: env.tagline,
        portLabel: env.portLabel,
        url: env.url,
        accent: env.accent,
        needs: env.needs ?? null,
        phase: rt.phase,
        detail: rt.detail,
        exitCode: rt.exitCode,
        livePort: rt.livePort,
        managed: rt.child !== null || rt.waiting,
      };
    });
  }

  allLogs() {
    const out = {};
    for (const env of ENVS) out[env.id] = this.rt.get(env.id).logs.slice();
    return out;
  }

  managedCount() {
    let n = 0;
    for (const rt of this.rt.values()) if (rt.child || rt.waiting) n += 1;
    return n;
  }

  emitState() {
    const snap = this.snapshot();
    const json = JSON.stringify(snap);
    if (json === this.lastSnapshotJson) return;
    this.lastSnapshotJson = json;
    this.emit('state', snap);
  }

  log(id, rawLines) {
    const rt = this.rt.get(id);
    const lines = rawLines
      .map((l) => l.replace(ANSI_RE, '').replace(/\r/g, '').trimEnd())
      .filter((l) => l.length > 0);
    if (lines.length === 0) return;
    rt.logs.push(...lines);
    if (rt.logs.length > LOG_BUFFER_MAX) rt.logs.splice(0, rt.logs.length - LOG_BUFFER_MAX);
    this.emit('log', { id, lines });
  }

  async pollOnce() {
    if (this.polling) return;
    this.polling = true;
    try {
      await Promise.all(
        ENVS.map(async (env) => {
          const rt = this.rt.get(env.id);
          let livePort = null;
          // Re-check a known live port first; fall back to scanning candidates.
          const candidates = rt.livePort
            ? [rt.livePort, ...env.ports.filter((p) => p !== rt.livePort)]
            : env.ports;
          for (const port of candidates) {
            // eslint-disable-next-line no-await-in-loop
            if (await probePort(port)) {
              livePort = port;
              break;
            }
          }
          rt.livePort = livePort;
          this.derivePhase(rt, livePort !== null);
        }),
      );
      this.emitState();
    } finally {
      this.polling = false;
    }
  }

  derivePhase(rt, portUp) {
    if (rt.phase === 'stopping') return; // stop() owns this transition
    if (rt.waiting) return; // the dependency waiter owns this transition
    if (rt.child) {
      rt.phase = portUp ? 'running' : 'starting';
      if (portUp) rt.detail = null;
      return;
    }
    if (portUp) {
      rt.phase = 'external';
      rt.detail = 'started outside the launcher';
      return;
    }
    if (rt.phase === 'external') {
      rt.phase = 'stopped';
      rt.detail = null;
      return;
    }
    // 'crashed' stays sticky (with its exit code) until the next start().
    if (rt.phase !== 'crashed' && rt.phase !== 'stopped') {
      // child gone, port down, not crashed: the exit handler already set
      // 'stopped'; normalize anything else (e.g. interrupted 'starting').
      if (rt.phase === 'starting' || rt.phase === 'waiting') return;
      rt.phase = 'stopped';
    }
  }

  async waitForPort(port, timeoutMs, isCancelled) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (isCancelled && isCancelled()) return false;
      // eslint-disable-next-line no-await-in-loop
      if (await probePort(port)) return true;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 700));
    }
    return false;
  }

  async waitForPortFree(ports, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const ups = await Promise.all(ports.map((p) => probePort(p)));
      if (!ups.some(Boolean)) return true;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  }

  async start(id) {
    const env = this.env(id);
    const rt = this.rt.get(id);
    if (
      rt.child ||
      rt.waiting ||
      rt.startPending ||
      rt.phase === 'external' ||
      rt.phase === 'stopping'
    ) {
      return;
    }
    // Synchronous in-flight marker: two start() calls arriving in the same
    // I/O cycle would otherwise both clear the guard above before either
    // reaches spawnEnv (the dep probe awaits in between).
    rt.startPending = true;
    try {
      rt.userStopped = false;
      rt.cancelWait = false;
      rt.exitCode = null;
      rt.detail = null;

      if (env.needs) {
        const dep = this.env(env.needs);
        const depRt = this.rt.get(env.needs);
        const depPort = dep.ports[0];

        if (depRt.phase === 'stopping') {
          // The dependency is being torn down right now. Its port may still
          // answer for a moment — waiting here keeps us off the "spawn the
          // shell against a dying vite" path (black window). Once the port
          // frees, the normal waiter below restarts the dependency.
          rt.waiting = true;
          rt.phase = 'waiting';
          rt.detail = `waiting for :${depPort} to free…`;
          this.emitState();
          await this.waitForPortFree(dep.ports, 12000);
          rt.waiting = false;
          if (rt.cancelWait) {
            rt.phase = 'stopped';
            rt.detail = null;
            this.emitState();
            return;
          }
        }

        if (!(await probePort(depPort))) {
          // The probe just proved the port down; a leftover 'external'
          // phase is stale (the poll hasn't caught up yet) and would make
          // start(dep) refuse at its guard. Normalize it first.
          if (depRt.phase === 'external' && !depRt.child) {
            depRt.phase = 'stopped';
            depRt.detail = null;
          }
          rt.waiting = true;
          rt.phase = 'waiting';
          rt.detail = `waiting for :${depPort}…`;
          this.emitState();
          if (!depRt.child && !depRt.waiting && !depRt.startPending) {
            this.log(id, [`> ${dep.title} is not up — starting it first`]);
            void this.start(env.needs);
          }
          const ok = await this.waitForPort(depPort, DEP_WAIT_TIMEOUT_MS, () => {
            if (rt.cancelWait) return true;
            // Bail early if the dependency died or was stopped instead of
            // burning the full timeout probing a port that will never open.
            // (By the time this first runs the dep is already 'starting', so
            // 'stopped'/'stopping' can only mean it went away again.)
            return (
              depRt.phase === 'crashed' ||
              depRt.phase === 'stopped' ||
              depRt.phase === 'stopping'
            );
          });
          rt.waiting = false;
          if (rt.cancelWait) {
            rt.phase = 'stopped';
            rt.detail = null;
            this.emitState();
            return;
          }
          if (!ok) {
            rt.phase = 'stopped';
            rt.detail =
              depRt.phase === 'crashed'
                ? `${dep.title} crashed while we waited`
                : depRt.phase === 'stopped' || depRt.phase === 'stopping'
                  ? `${dep.title} was stopped while we waited`
                  : `gave up waiting for :${depPort}`;
            this.log(id, [`> ${rt.detail} — not starting ${env.title}`]);
            this.emitState();
            return;
          }
          this.log(id, [`> :${depPort} is accepting connections`]);
        }
      }

      // Re-check after the awaits above: a competing start/stop or an
      // externally appeared listener may have changed the world.
      if (rt.child || rt.phase === 'external') return;
      this.spawnEnv(env, rt);
    } finally {
      rt.startPending = false;
    }
  }

  spawnEnv(env, rt) {
    rt.phase = 'starting';
    rt.detail = null;
    this.log(env.id, [`$ ${env.command}`]);
    const child = spawn(env.command, {
      cwd: env.cwd,
      shell: true,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NO_COLOR: '1',
        FORCE_COLOR: '0',
        CARGO_TERM_COLOR: 'never',
      },
    });
    rt.child = child;
    rt.pid = child.pid ?? null;
    const buffers = { out: '', err: '' };
    rt.lineBuffers = buffers;
    // Stateful decoders: a multibyte UTF-8 glyph split across pipe chunks
    // must not decode each half to U+FFFD.
    const decoders = { out: new StringDecoder('utf8'), err: new StringDecoder('utf8') };

    const onChunk = (key) => (chunk) => {
      buffers[key] += decoders[key].write(chunk);
      const parts = buffers[key].split(/\r?\n/);
      buffers[key] = parts.pop() ?? '';
      this.log(env.id, parts);
    };
    child.stdout.on('data', onChunk('out'));
    child.stderr.on('data', onChunk('err'));

    child.once('error', (err) => {
      if (rt.child !== child) return; // a newer spawn owns this slot
      rt.child = null;
      rt.pid = null;
      rt.phase = 'crashed';
      rt.detail = err.message;
      this.log(env.id, [`> failed to spawn: ${err.message}`]);
      this.emitState();
    });

    // 'close' (streams flushed) rather than 'exit' for the tail, so the
    // last unterminated output line is not lost or reordered.
    child.once('close', () => {
      buffers.out += decoders.out.end();
      buffers.err += decoders.err.end();
      const tail = [buffers.out, buffers.err].filter(Boolean);
      if (tail.length) this.log(env.id, tail);
    });

    child.once('exit', (code, signal) => {
      if (rt.child !== child) return; // a newer spawn owns this slot
      rt.child = null;
      rt.pid = null;
      if (rt.userStopped) {
        rt.phase = 'stopped';
        rt.detail = null;
      } else if (code === 0 || signal) {
        rt.phase = 'stopped';
        rt.detail = signal ? `killed (${signal})` : 'exited cleanly';
      } else {
        rt.phase = 'crashed';
        rt.exitCode = code;
        rt.detail = `exit code ${code}`;
      }
      this.log(env.id, [`> process exited (${signal ?? code ?? 'unknown'})`]);
      this.emitState();
    });

    this.emitState();
  }

  async stop(id) {
    const env = this.env(id);
    const rt = this.rt.get(id);
    if (rt.waiting) {
      // Still in the wait-for-dependency stage: just cancel the wait.
      rt.cancelWait = true;
      return;
    }
    const pid = rt.pid;
    if (!pid) return;
    rt.userStopped = true;
    rt.phase = 'stopping';
    rt.detail = null;
    this.emitState();
    this.log(id, [`> stopping (taskkill /T pid ${pid})`]);
    await killTree(pid);
    if (env.stopCleanup) {
      rt.detail = 'tearing down…';
      this.emitState();
      try {
        await env.stopCleanup((line) => this.log(id, [line]));
      } catch (err) {
        this.log(id, [`> cleanup failed: ${err.message}`]);
      }
    }
    // The 'exit' handler flips the phase; give it a moment, then make sure
    // nothing is still holding the port (an orphan would re-surface as
    // "external" via the poll loop either way).
    const freed = await this.waitForPortFree(env.ports, 8000);
    if (rt.phase === 'stopping') {
      rt.phase = 'stopped';
      rt.detail = null;
    }
    if (!freed) {
      rt.detail = 'warning: port still in use after stop';
      this.log(id, ['> warning: port still in use after stop']);
    }
    rt.livePort = null;
    this.emitState();
  }

  async stopAll() {
    for (const rt of this.rt.values()) if (rt.waiting) rt.cancelWait = true;
    const jobs = [];
    for (const [id, rt] of this.rt.entries()) {
      if (rt.pid) jobs.push(this.stop(id));
    }
    await Promise.race([
      Promise.all(jobs),
      new Promise((r) => setTimeout(r, 6000)),
    ]);
  }

  // Belt-and-braces sweep for quit paths that cannot await (before-quit,
  // process exit). Synchronous taskkill per live pid, plus each managed
  // env's sync cleanup (e.g. android's adb emu kill) — gated on "we were
  // running it" so quitting never touches an env the launcher didn't start.
  killAllSync() {
    for (const [id, rt] of this.rt.entries()) {
      const wasManaged = rt.pid !== null || rt.waiting;
      if (rt.pid) killTreeSync(rt.pid);
      rt.child = null;
      rt.pid = null;
      if (rt.waiting) rt.cancelWait = true;
      const env = this.env(id);
      if (wasManaged && env.stopCleanupSync) {
        try {
          env.stopCleanupSync();
        } catch {
          // best effort on the way out
        }
      }
    }
  }
}

module.exports = { DevManager, ENVS, ROOT, probePort, killTree };
