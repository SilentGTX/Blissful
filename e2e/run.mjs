#!/usr/bin/env node
// Blissful E2E runner — pick the suites relevant to a change and run them.
//
//   node e2e/run.mjs                  all suites, all projects
//   node e2e/run.mjs --changed        only suites whose AREA matches git-changed files
//   node e2e/run.mjs --area player    a named area (player | watch-party | shell)
//   node e2e/run.mjs --project web    passthrough (any extra args go to `playwright test`)
//   node e2e/run.mjs --changed -- --project web    args after `--` are passed through
//
// "changed" = working tree (staged + unstaged) ∪ committed-but-unpushed (origin/main..HEAD),
// i.e. "what I've touched since the last push". The area map is intentionally explicit;
// extend it as suites are added. Nothing is silently skipped — unmapped changes are logged.

import { execSync, spawnSync } from 'node:child_process';

// area -> { paths: source-path patterns that affect it, filter: suite filename filter }
const AREAS = {
  player: {
    paths: [/BlissfulPlayer/, /NativeMpvPlayer/, /\/player\//, /lib\/desktop\.ts/, /useChapterSkip/],
    filter: 'player.',
  },
  'watch-party': {
    paths: [/watchParty/i, /useWatchParty/, /components\/WatchParty/, /party-relay/, /host_relay/, /blissful-storage/, /addon-proxy/],
    filter: 'watch-party', // suites land here as the .mjs harnesses migrate
  },
  shell: {
    paths: [/desktop-blissful\/src\/(webview|streaming_server|host_relay|ipc)/],
    filter: 'shell-', // shell-recovery.desktop, etc.
  },
};

const argv = process.argv.slice(2);
const dashDash = argv.indexOf('--');
const passthrough = dashDash >= 0 ? argv.slice(dashDash + 1) : [];
const opts = dashDash >= 0 ? argv.slice(0, dashDash) : argv;

function gitLines(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8' }).split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}
function changedFiles() {
  return [
    ...new Set([
      ...gitLines('git diff --name-only origin/main...HEAD'),
      ...gitLines('git diff --name-only'),
      ...gitLines('git diff --name-only --cached'),
      ...gitLines('git ls-files --others --exclude-standard'),
    ]),
  ];
}
function run(filters) {
  const args = ['playwright', 'test', ...filters, ...passthrough];
  console.log(`[e2e] npx ${args.join(' ')}`);
  const r = spawnSync('npx', args, { stdio: 'inherit', shell: process.platform === 'win32' });
  process.exit(r.status ?? 1);
}

if (opts.includes('--changed')) {
  const files = changedFiles();
  if (!files.length) {
    console.log('[e2e] no changed files vs the last push — running the smoke baseline');
    run(['smoke']);
  }
  const matched = Object.entries(AREAS).filter(([, a]) => files.some((f) => a.paths.some((re) => re.test(f))));
  if (!matched.length) {
    console.log('[e2e] changed files map to no suite AREA yet (extend e2e/run.mjs). Running smoke only.');
    console.log('      changed:\n        ' + files.join('\n        '));
    run(['smoke']);
  }
  console.log(`[e2e] changed areas: ${matched.map(([k]) => k).join(', ')}`);
  run([...new Set(['smoke', ...matched.map(([, a]) => a.filter)])]);
} else if (opts[0] === '--area') {
  const area = AREAS[opts[1]];
  if (!area) {
    console.error(`[e2e] unknown area "${opts[1]}". Known: ${Object.keys(AREAS).join(', ')}`);
    process.exit(2);
  }
  run([area.filter]);
} else {
  run(opts); // all, or passthrough like `--project web`
}
